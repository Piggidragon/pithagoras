import type { PortalEvent } from './api';
/** Match direct browser tools and the MCP adapter's wrapped browser calls. */
export function latestBrowserActivity(events: PortalEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'tool_execution_start') continue;
    const p = event.payload ?? {}, name = p.toolName ?? p.name ?? '';
    const input = p.input ?? p.args ?? p.parameters ?? {};
    if (/(^|[_.])browser[_.]/i.test(name) || name === 'mcp' && ['server', 'connect', 'tool', 'describe'].some(k => typeof input[k] === 'string' && /browser/i.test(input[k]))) return event.seq;
  }
  return 0;
}

export function latestTerminalActivity(events: PortalEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'tool_execution_start' && /^(bash|shell|terminal|exec_command)$/.test(event.payload?.toolName ?? event.payload?.name ?? '')) return event.seq;
  }
  return 0;
}
