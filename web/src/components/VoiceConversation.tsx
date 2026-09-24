import { useLayoutEffect, useRef } from "react";
import { api } from "../api";
import type { Item } from "../transcript";

/** How much of the conversation the window shows: enough to find what was just said. */
const SHOWN = 30;

/**
 * The conversation so far, in a window beside the orb like Files and pictures.
 *
 * Voice mode puts the chat away, and with it any way to check what was
 * understood or to read a number that went by too fast. This shows it
 * without ending voice mode: what was said, as transcribed, and what
 * came back, as written — which is also the only way to see a reply that was
 * interrupted before it was spoken.
 */
export function VoiceConversation({ sessionId, items }: { sessionId: string; items: Item[] }) {
  const list = items.filter(item => item.kind === "user" || (item.kind === "assistant" && item.text.trim())).slice(-SHOWN);
  const viewport = useRef<HTMLDivElement>(null);
  const last = list.at(-1);
  const lastLength = last?.kind === "assistant" ? last.text.length : 0;
  useLayoutEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last?.id, lastLength]);
  return <div ref={viewport} className="voice-conversation-list">
      {!list.length && <p className="voice-conversation-empty">Nothing has been said yet.</p>}
      {list.map(item => item.kind === "user"
        ? <div key={item.id} className="voice-said is-user">
            {item.text && <p>{item.text}</p>}
            {item.images?.length ? <div className="voice-said-pictures">{item.images.map(image => <img key={image.name} src={api.imageUrl(sessionId, image.name)} alt="" loading="lazy" />)}</div> : null}
          </div>
        : item.kind === "assistant"
          ? <div key={item.id} className="voice-said is-agent"><p>{item.text}</p></div>
          : null)}
  </div>;
}
