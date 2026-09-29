import type { PortalEvent } from './api';

export function resetLiveEvents(events: PortalEvent[]): PortalEvent[] {
  return events.filter(e => !(e.seq < 0 && ['message_update', 'message_snapshot', 'tool_execution_update', 'portal_subagent_live'].includes(e.type)));
}

/** Replace completed live streams with their durable result, keeping the stable message id. */
export function appendLiveEvent(events: PortalEvent[], event: PortalEvent): PortalEvent[] {
  const p = event.payload ?? {};
  const kept = events.filter(e => {
    if (e.seq >= 0) return true;
    if (event.type === 'message_end' && p.streamId && e.payload?.streamId === p.streamId) return false;
    if (event.type === 'tool_execution_end' && e.type === 'tool_execution_update' && p.toolCallId && e.payload?.toolCallId === p.toolCallId) return false;
    if (event.type === 'tool_execution_update' && e.type === 'tool_execution_update' && p.toolCallId && e.payload?.toolCallId === p.toolCallId) return false;
    // A subagent's stream, the same way: its message ends, its tool's newest output replaces the last.
    if (e.type === 'portal_subagent_live' && (event.type === 'portal_subagent' || event.type === 'portal_subagent_live') && e.payload?.id === p.id) {
      const inner = p.event ?? {}, was = e.payload?.event ?? {};
      if (p.op === 'end') return false;
      if (inner.type === 'message_end' && was.type === 'message_update') return false;
      if ((inner.type === 'tool_execution_end' || inner.type === 'tool_execution_update') && was.type === 'tool_execution_update' && was.toolCallId === inner.toolCallId) return false;
    }
    return true;
  });
  return [...kept, event];
}
