import { Component, type ReactNode } from "react";
import { LuRotateCw, LuTriangleAlert } from "react-icons/lu";

/**
 * What a page that threw is replaced with, instead of the whole portal going
 * blank: the sidebar stays, the other pages still open, and this one can be
 * tried again. `resetKey` changing — another page, another chat — starts over.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error("[portal] a page failed to draw:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-danger/10 text-danger">
          <LuTriangleAlert className="h-5 w-5" />
        </div>
        <p className="text-sm text-fg">This page ran into a problem and could not be shown.</p>
        <p className="max-w-md break-words font-mono text-[11px] text-fg-faint">{error.message}</p>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20"
          >
            <LuRotateCw className="h-3.5 w-3.5" /> Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition hover:bg-fg/5 hover:text-fg"
          >
            Reload the portal
          </button>
        </div>
      </div>
    );
  }
}
