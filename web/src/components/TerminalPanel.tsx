import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api";

/**
 * A shell in the workspace of the session you are looking at.
 *
 * Output arrives over SSE and keystrokes go back as POSTs — the same shape the
 * transcript already uses, and no websocket to add. The scrollback is replayed
 * on connect, so collapsing the panel and opening it again keeps the screen.
 */
export function TerminalPanel({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      // Reads against the portal's own surfaces rather than shipping a second
      // colour scheme that only matches in one theme.
      theme: { background: "#0b0b0d", foreground: "#d4d4d8" },
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    let id: string | null = null;
    let source: EventSource | null = null;
    let closed = false;

    api
      .openTerminal(sessionId)
      .then(({ id: termId }) => {
        if (closed) return void api.closeTerminal(termId).catch(() => {});
        id = termId;
        source = new EventSource(`/api/terminal/${termId}/stream`);
        source.onmessage = (m) => term.write(JSON.parse(m.data));
        // Keystrokes that go nowhere — the shell has exited, or the portal has
        // restarted — used to vanish, and the panel looked merely unresponsive.
        // Said once, not on every key.
        let told = false;
        term.onData((data) =>
          api.terminalInput(termId, data).catch(() => {
            if (told || closed) return;
            told = true;
            term.write("\r\n[Connection to the shell lost — close this panel and open it again]\r\n");
          }),
        );
        api.terminalResize(termId, term.rows, term.cols).catch(() => {});
      })
      .catch((e) => term.write(`\r\nCould not open a shell: ${e.message}\r\n`));

    // The panel is resizable, so the pty has to be told when it changes.
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (id) api.terminalResize(id, term.rows, term.cols).catch(() => {});
    });
    observer.observe(host.current);

    return () => {
      closed = true;
      observer.disconnect();
      source?.close();
      if (id) api.closeTerminal(id).catch(() => {});
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={host} className="h-full w-full bg-[#0b0b0d] p-1" />;
}
