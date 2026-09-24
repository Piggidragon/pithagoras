import type { SessionStatus } from "../api";

const LABEL: Record<SessionStatus, string> = {
  running: "running",
  idle: "idle",
  error: "error",
  interrupted: "interrupted — server restarted mid-run",
};

/**
 * How a chat is doing, as a dot: the same everywhere a list of chats is
 * shown. A running one sends out a ring rather than blinking, so a list with
 * several going reads as busy, not as broken.
 */
export function StatusDot({ status, className = "" }: { status: SessionStatus; className?: string }) {
  return <span className={`status-dot is-${status} ${className}`} title={LABEL[status]} role="img" aria-label={LABEL[status]} />;
}
