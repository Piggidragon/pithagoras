import type { SessionStatus } from "../api";

const LABEL: Record<SessionStatus, string> = {
  running: "running",
  idle: "idle",
  error: "error",
  interrupted: "interrupted — server restarted mid-run",
};

/**
 * How a chat is doing: the same everywhere a list of chats is shown. At rest
 * a dot; working, the app's π, breathing with a glow behind it — the way the
 * thinking in a chat breathes — rather than one more spinner or blinking dot.
 * Its title shimmers beside it (`working-text`), as "Thinking" does.
 */
export function StatusDot({ status, className = "" }: { status: SessionStatus; className?: string }) {
  if (status === "running") {
    return (
      <span className={`status-working ${className}`} title={LABEL.running} role="img" aria-label={LABEL.running}>
        <span aria-hidden>π</span>
      </span>
    );
  }
  return <span className={`status-dot is-${status} ${className}`} title={LABEL[status]} role="img" aria-label={LABEL[status]} />;
}

/** A chat's title while it works: it shimmers, as "Thinking" does in the chat. */
export const workingText = (status: SessionStatus) => (status === "running" ? "working-text" : "");
