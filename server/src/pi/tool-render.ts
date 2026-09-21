import { TuiSurface, type TuiComponent } from "./tui-bridge.js";
import type { TuiRuntime } from "./tui-runtime.js";

/**
 * A tool's own picture of what it did.
 *
 * pi lets a tool ship renderCall and renderResult — pi-tui components drawn in
 * place of the generic row. That is where an extension puts the part a summary
 * cannot carry: pi-web-access draws its search sources there, which is why a
 * web search in the portal showed none. Nothing here knows about any tool; it
 * asks the tool to draw and passes on what came back.
 *
 * Both views are drawn, because the collapsed one is deliberately thin — for a
 * search it is a single status line, and everything worth having is in the
 * other. Drawing both on the server means opening it is instant and works on a
 * conversation reopened months later, when the tool that drew it may not even
 * be installed any more.
 */

/** What a tool drew, as lines of ANSI. */
export interface ToolRender {
  collapsed: string[];
  /** Only when it differs — most tools draw one thing and ignore the flag. */
  expanded?: string[];
}

/** Wide enough for a table, narrow enough to read in a column beside a panel. */
const RENDER_COLS = 100;

/**
 * A ceiling on what goes into the event log.
 *
 * tool_execution_end is stored, so this is written once and read forever. A
 * tool that renders a whole file would otherwise put it in the database a
 * second time.
 */
const MAX_LINES = 400;
const MAX_CHARS = 40_000;

/** Per tool call, because pi's contract shares it between the call and the result. */
interface CallState {
  state: Record<string, unknown>;
  lastCall?: TuiComponent;
  lastResult?: TuiComponent;
}

export class ToolRenderer {
  private calls = new Map<string, CallState>();

  constructor(
    private readonly runtime: TuiRuntime,
    private readonly cwd: string,
    private readonly lookup: (name: string) => any
  ) {}

  /**
   * What this tool event should show, or undefined when the tool has no opinion
   * — which is most of them, and is why the generic row still exists.
   */
  render(event: any): ToolRender | undefined {
    const name = event?.toolName;
    if (typeof name !== "string") return undefined;
    let definition: any;
    try {
      definition = this.lookup(name);
    } catch {
      return undefined;
    }
    if (!definition) return undefined;

    const id = String(event.toolCallId ?? name);
    const call = this.calls.get(id) ?? { state: {} };
    this.calls.set(id, call);

    try {
      if (event.type === "tool_execution_start") {
        if (!definition.renderCall) return undefined;
        const component = definition.renderCall(
          event.args,
          this.runtime.theme,
          this.context(call, event, false)
        );
        call.lastCall = component;
        return component ? { collapsed: draw(component) } : undefined;
      }

      if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        if (!definition.renderResult) return undefined;
        const isPartial = event.type === "tool_execution_update";
        const result = isPartial ? event.partialResult : event.result;
        if (!result) return undefined;
        const context = this.context(call, event, true);
        const collapsed = this.draw(definition, result, { expanded: false, isPartial }, context);
        if (!collapsed) return undefined;
        const expanded = this.draw(definition, result, { expanded: true, isPartial }, context);
        // A tool that ignores the flag draws the same thing twice; offering to
        // open it would be offering nothing.
        return same(collapsed, expanded) ? { collapsed } : { collapsed, expanded };
      }
    } catch {
      // A tool that cannot draw still ran, and the row it would have replaced
      // is still there. Nothing said, nothing lost.
      return undefined;
    }
    return undefined;
  }

  /** The call is over; its shared state has nobody left to share it with. */
  forget(toolCallId: string): void {
    this.calls.delete(toolCallId);
  }

  clear(): void {
    this.calls.clear();
  }

  private draw(
    definition: any,
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    context: Record<string, unknown>
  ): string[] | undefined {
    const component = definition.renderResult(result, options, this.runtime.theme, context);
    return component ? draw(component) : undefined;
  }

  private context(call: CallState, event: any, isResult: boolean): Record<string, unknown> {
    return {
      args: event.args,
      toolCallId: String(event.toolCallId ?? ""),
      // Nothing here redraws on its own: an event produced this, and the next
      // event will produce the next one.
      invalidate: () => {},
      lastComponent: isResult ? call.lastResult : call.lastCall,
      state: call.state,
      cwd: this.cwd,
      executionStarted: true,
    };
  }
}

/** One render of a component that is only wanted for its lines. */
function draw(component: TuiComponent): string[] {
  const surface = new TuiSurface({ cols: RENDER_COLS, rows: MAX_LINES, onFrame: () => {} });
  try {
    surface.attach(component);
    return cap(surface.lines());
  } finally {
    surface.dispose();
  }
}

function cap(lines: string[]): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (out.length >= MAX_LINES || chars >= MAX_CHARS) {
      out.push("  …");
      break;
    }
    out.push(line);
    chars += line.length;
  }
  return out;
}

const same = (a: string[], b: string[] | undefined): boolean =>
  !b || (a.length === b.length && a.every((line, i) => line === b[i]));
