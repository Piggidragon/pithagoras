import { useEffect, useState } from 'react';
import type { Activity } from '../transcript';

const promptLabels = ['Reading the conversation…', 'Reviewing the context…', 'Preparing to respond…'];

export function ActivityProgress({ phase, compact = false }: { phase: Activity; compact?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [phase.since]);
  const seconds = Math.max(0, Math.floor((now - (phase.since ?? now)) / 1000));
  const p = phase.prefill;
  const total = p?.total ?? 0;
  const done = Math.max(0, Math.min(total, p?.processed ?? 0));
  const percent = total > 0 ? Math.round(done / total * 100) : undefined;
  const compacting = phase.label === 'compacting the conversation';
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  if (!compacting && seconds < 2) return null;
  return <div className={`activity-progress ${compact ? 'activity-progress-compact' : ''}`}>
    <div className="activity-progress-heading"><span role="status">{compacting ? 'Compacting conversation' : promptLabels[Math.floor(Math.max(0, seconds - 2) / 3) % promptLabels.length]}</span><span>{percent !== undefined ? `${percent}% · ` : ''}{elapsed}</span></div>
    <div className="activity-progress-track" role="progressbar" aria-label={compacting ? 'Conversation compaction' : 'Prompt processing'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className={percent === undefined ? 'activity-progress-indeterminate' : ''} style={percent === undefined ? undefined : {width: `${percent}%`}} />
    </div>
    {!compact && <p>{total > 0 ? `${done.toLocaleString()} / ${total.toLocaleString()} tokens${p?.cache ? ` · ${p.cache.toLocaleString()} cached` : ''}` : compacting ? 'Summarizing earlier messages to make room. Your conversation will continue when ready.' : 'Reading the conversation before replying. This can take longer with a large history.'}</p>}
  </div>;
}
