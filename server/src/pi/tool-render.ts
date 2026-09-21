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

/**
 * Per tool call, because pi's contract shares it between the call and the
 * result.
 *
 * The two result views are kept apart. pi hands a renderer the component it
 * built last time so it can update that one instead of building another, and
 * what it built for the open row is not what it built for the closed one —
 * handing over the wrong one would have it update the view nobody asked about.
 */
interface CallState {
  state: Record<string, unknown>;
  lastCall?: TuiComponent;
  lastCollapsed?: TuiComponent;
  lastExpanded?: TuiComponent;
  /**
   * The arguments the tool was called with.
   *
   * pi's contract is that these are "shared across call/result renders for the
   * same tool call", and the end event does not carry them — only the start
   * and the updates do. A renderer that draws "results for <query>" would
   * otherwise throw on the one event that is kept, and the row it drew would
   * be missing from every reopened conversation.
   */
  args?: unknown;
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
    if (event.args !== undefined) call.args = event.args;

    try {
      if (event.type === "tool_execution_start") {
        if (!definition.renderCall) return undefined;
        const component = definition.renderCall(
          event.args,
          this.runtime.theme,
          this.context(call, event, call.lastCall, false)
        );
        call.lastCall = component;
        return component ? { collapsed: draw(component) } : undefined;
      }

      if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        if (!definition.renderResult) return undefined;
        const isPartial = event.type === "tool_execution_update";
        const result = isPartial ? event.partialResult : event.result;
        if (!result) return undefined;
        const collapsed = this.drawResult(definition, result, isPartial, call, event, false);
        if (!collapsed) return undefined;
        const expanded = this.drawResult(definition, result, isPartial, call, event, true);
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

  private drawResult(
    definition: any,
    result: unknown,
    isPartial: boolean,
    call: CallState,
    event: any,
    expanded: boolean
  ): string[] | undefined {
    const last = expanded ? call.lastExpanded : call.lastCollapsed;
    const component = definition.renderResult(
      result,
      { expanded, isPartial },
      this.runtime.theme,
      this.context(call, event, last, expanded)
    );
    if (expanded) call.lastExpanded = component;
    else call.lastCollapsed = component;
    return component ? draw(component) : undefined;
  }

  /**
   * The whole of pi's ToolRenderContext, not the half of it this used to pass.
   *
   * A renderer may read `expanded` off the context rather than off the options
   * — pi's own tool-execution.ts sets both, so either is fair. Reading an
   * absent one meant drawing the closed view twice, the two coming out
   * identical, and **More** never appearing: the thing this class is for,
   * quietly gone.
   */
  private context(
    call: CallState,
    event: any,
    lastComponent: TuiComponent | undefined,
    expanded: boolean
  ): Record<string, unknown> {
    return {
      args: call.args,
      toolCallId: String(event.toolCallId ?? ""),
      // Nothing here redraws on its own: an event produced this, and the next
      // event will produce the next one.
      invalidate: () => {},
      lastComponent,
      state: call.state,
      cwd: this.cwd,
      executionStarted: true,
      argsComplete: true,
      isPartial: event.type === "tool_execution_update",
      expanded,
      // There is no terminal to put an image in; what a tool draws here is
      // text either way.
      showImages: false,
      isError: Boolean(event.isError),
    };
  }
}

/**
 * One render of a component that is only wanted for its lines.
 *
 * Released rather than disposed: the component is the tool's, kept by it
 * between renders, and this surface only borrowed it for a drawing.
 */
function draw(component: TuiComponent): string[] {
  const surface = new TuiSurface({ cols: RENDER_COLS, rows: MAX_LINES, onFrame: () => {} });
  try {
    surface.attach(component);
    return cap(surface.lines());
  } finally {
    surface.release();
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
