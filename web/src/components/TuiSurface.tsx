import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api";
import type { FrameBus } from "../tui-frames";

/** Where the screen starts before anything has been drawn, and the most it may take. */
const OPENING_FRACTION = 0.6;

/**
 * A screen an extension drew, shown where it was drawn for.
 *
 * The component runs on the server and sends frames; this writes them. The
 * translation both ways is the terminal itself — xterm produces exactly the
 * byte sequences a TTY would have sent, which is exactly what a pi component's
 * handleInput expects, so no key here is named or mapped. An extension written
 * for the TUI years ago works, and so does one written tomorrow.
 *
 * Scrollback is off on purpose. Every frame repaints the whole viewport from
 * the top, so a scrolled-back terminal would be showing a screen that no
 * longer exists.
 */
export function TuiSurface({
  sessionId,
  requestId,
  frames,
}: {
  sessionId: string;
  requestId: string;
  frames: FrameBus;
}) {
  const host = useRef<HTMLDivElement>(null);
  /**
   * The screen is as tall as what was drawn, not as tall as the dialog.
   *
   * A three-line menu in a terminal sized to the window is mostly empty black,
   * which reads as something having gone wrong. The opening height is taken
   * from the window rather than from the box around it, because that box is
   * this — measuring it would be measuring the answer.
   */
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * OPENING_FRACTION));

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      // The same surface the shell panel uses. pi's components carry their own
      // colours, and a second scheme underneath them would only ever match in
      // one of the portal's themes.
      theme: { background: "#0b0b0d", foreground: "#d4d4d8" },
      cursorBlink: false,
      scrollback: 0,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    // Measured while the screen is still at its opening height, so there is a
    // row height to divide by. Both stay fixed afterwards: the component is
    // never told how tall the screen is, so what it draws cannot depend on it,
    // and shrinking to fit can never feed back into what there is to fit.
    const rowPx = host.current.clientHeight / Math.max(1, term.rows);
    const maxRows = Math.max(4, term.rows);
    let cols = Math.max(20, term.cols);

    const fitTo = (lines: number) => {
      const rows = Math.min(Math.max(lines, 1), maxRows);
      term.resize(cols, rows);
      setHeight(Math.round(rows * rowPx));
    };

    // Subscribed before the size goes out, or the frame that the resize
    // produces arrives while nobody is listening.
    const unsubscribe = frames.subscribe(requestId, (frame) => {
      term.write(frame.data);
      fitTo(frame.lines);
    });

    const report = () => {
      api
        .uiResize(sessionId, requestId, cols, maxRows)
        // The reply carries the screen as it stands, which is what a terminal
        // that has only just opened has instead of a frame it never saw.
        .then((r) => {
          if (!r.frame) return;
          term.write(r.frame.data);
          fitTo(r.frame.lines);
        })
        .catch(() => {});
    };
    report();

    const typed = term.onData((data) => {
      api.uiInput(sessionId, requestId, data).catch(() => {});
    });

    // Only the width: the height is this component's own doing, and reacting
    // to it would be reacting to itself.
    let lastWidth = host.current.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = host.current?.clientWidth ?? lastWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const proposed = fit.proposeDimensions();
      if (!proposed?.cols) return;
      cols = Math.max(20, proposed.cols);
      term.resize(cols, term.rows);
      report();
    });
    observer.observe(host.current);

    return () => {
      observer.disconnect();
      typed.dispose();
      unsubscribe();
      term.dispose();
    };
  }, [sessionId, requestId, frames]);

  return (
    <div
      ref={host}
      style={{ height, maxHeight: `${OPENING_FRACTION * 100}vh` }}
      className="w-full bg-[#0b0b0d] p-1 transition-[height] duration-150"
    />
  );
}
