import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuCircleAlert, LuLoaderCircle, LuSparkles } from 'react-icons/lu';
import type { PortalEvent } from '../api';
import { describeCall, describeOutcome, elapsed, type ToolCall } from '../tool-activity';

/** A card for one tool call, in one of four places around the orb. */
type Card = ToolCall & {
  id: number; callId: string; start: unknown; startedAt: number;
  status: 'running' | 'done' | 'failed'; outcome: string;
  slot: number; leaving: boolean;
};

/** How long a finished card stays: long enough to read its outcome, longer for a failure. */
const STAYS = { done: 4500, failed: 7000 };
/** How long a card takes to go, so it is taken out after its animation. */
const LEAVING = 600;
const SLOTS = 4;

/**
 * What the agent is doing, as cards flying out of the orb.
 *
 * A card stays while its call runs — a long build is still going, and a card
 * that faded after eight seconds said nothing about the minutes after — and
 * shows how long it has been. When the call ends it says what came of it, and
 * goes a few seconds later. One that can be looked at opens it when tapped:
 * the file in Files, the terminal, the browser, the document, the picture.
 */
export function VoiceToolActivity({ events, folder, onOpen }: { events: PortalEvent[]; folder: string; onOpen: (call: ToolCall) => void }) {
  const seen = useRef(Math.max(0, ...events.map(e => e.seq)));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cards = useRef<Card[]>([]);
  const [shown, setShown] = useState<Card[]>([]);
  const [, setNow] = useState(0);
  const update = (next: Card[]) => { cards.current = next; setShown(next); };
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => { timers.current.delete(timer); run(); }, ms);
    timers.current.add(timer);
  };
  const leave = (id: number) => {
    update(cards.current.map(card => card.id === id ? { ...card, leaving: true } : card));
    later(LEAVING, () => update(cards.current.filter(card => card.id !== id)));
  };

  useEffect(() => {
    const fresh = events.filter(e => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(seen.current, ...fresh.map(e => e.seq));
    let next = cards.current;
    for (const event of fresh) {
      const p = event.payload ?? {};
      if (event.type === 'tool_execution_start') {
        let taken = new Set(next.filter(c => !c.leaving).map(c => c.slot));
        if (taken.size >= SLOTS) {
          // Full: the oldest finished card makes room, or failing that the oldest of all.
          const out = next.find(c => !c.leaving && c.status !== 'running') ?? next.find(c => !c.leaving)!;
          next = next.filter(c => c !== out);
          taken = new Set(next.filter(c => !c.leaving).map(c => c.slot));
        }
        const slot = [0, 1, 2, 3].find(s => !taken.has(s)) ?? 0;
        next = [...next, { ...describeCall(p, folder), id: event.seq, callId: String(p.toolCallId ?? ''), start: p, startedAt: Date.now(), status: 'running', outcome: '', slot, leaving: false }];
      } else if (event.type === 'tool_execution_end') {
        const card = next.find(c => c.callId && c.callId === String(p.toolCallId ?? '') && c.status === 'running');
        if (!card) continue;
        const status = p.isError ? 'failed' as const : 'done' as const;
        next = next.map(c => c === card ? { ...c, status, outcome: describeOutcome(c.start, p) } : c);
        later(STAYS[status], () => leave(card.id));
      } else if (event.type === 'agent_end' || (event.type === 'portal_status' && p.status !== 'running')) {
        // The run is over: a call that never reported its end is not still going.
        for (const card of next) if (card.status === 'running' && !card.leaving) later(0, () => leave(card.id));
      }
    }
    update(next);
  }, [events, folder]);

  // A running card counts its time, so it is only redrawn while one is.
  const running = shown.some(card => card.status === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);

  return <div className="voice-tool-activity" aria-label="Tool activity" aria-live="polite" aria-relevant="additions">
    {shown.map(card => {
      const took = Date.now() - card.startedAt;
      const note = card.status === 'running' ? (took >= 3000 ? elapsed(took) : '') : card.outcome;
      const className = `voice-tool-float flies-${card.slot % 2 ? 'right' : 'left'} flight-lane-${Math.floor(card.slot / 2)} is-${card.status}${card.leaving ? ' is-leaving' : ''}`;
      const body = <>
        {card.status === 'failed' ? <LuCircleAlert aria-hidden="true" /> : card.status === 'done' ? <LuCheck aria-hidden="true" /> : took >= 3000 ? <LuLoaderCircle aria-hidden="true" className="animate-spin" /> : <LuSparkles aria-hidden="true" />}
        <div>
          <span>{card.label}</span>
          {card.detail && <p>{card.detail}</p>}
          {note && <p className="voice-tool-note">{card.status === 'failed' ? `Failed: ${note}` : note}</p>}
          {!note && card.status === 'failed' && <p className="voice-tool-note">Failed</p>}
        </div>
      </>;
      return card.target
        ? <button key={card.id} type="button" className={className} onClick={() => onOpen(card)} title={`Show ${card.target === 'files' ? card.path ?? 'files' : card.target}`}>{body}</button>
        : <div key={card.id} className={className}>{body}</div>;
    })}
  </div>;
}
