/**
 * `subagent`: hand a task to a second pi, and let the person watch it and
 * talk to it from the portal.
 *
 * The reference for the subagent protocol (server/src/subagent-protocol.ts in
 * the portal). The child runs `pi --mode rpc`, so it can be steered while it
 * works: what the person types for it arrives as an RPC `steer`. Every event
 * the child prints is passed on unchanged, and the portal draws it like the
 * main conversation. Outside the portal nobody listens on those channels and
 * the tool is simply a subagent.
 *
 * Two ways to run, set by `subagentMode` in pi's settings.json:
 *
 * - "interrupt" (the default): the tool call waits for the child's answer, and
 *   children run one at a time. Only one agent works at once, which is what a
 *   single GPU wants.
 * - "background": the tool call returns at once and the parent goes on; the
 *   child's answer arrives later as a message, and starts a turn if the parent
 *   is idle. Two agents run at the same time.
 *
 * PI_SUBAGENT_BIN picks the pi to run (default: `pi` on PATH).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Type } from "typebox";

const START = "subagent:v1:start";
const EVENT = "subagent:v1:event";
const END = "subagent:v1:end";
const INPUT = "subagent:v1:input";
const STOP = "subagent:v1:stop";

export type Mode = "interrupt" | "background";

/** How a subagent runs against its parent: pi's settings say, read each time so a change needs no restart. */
export function subagentMode(): Mode {
  const dir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".pi", "agent");
  try {
    const settings = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"));
    return settings?.subagentMode === "background" ? "background" : "interrupt";
  } catch {
    return "interrupt";
  }
}

type Status = "done" | "error" | "stopped";
interface Run {
  id: string;
  /** Settles once the child has, with what it said last. */
  finished: Promise<{ status: Status; answer: string; failure?: string }>;
  stop(): void;
}

const DESCRIPTIONS: Record<Mode, string> = {
  interrupt:
    "Hand a self-contained task to a separate agent with its own context, and get its final answer back. Use for research or investigation that would otherwise fill this conversation. The person can watch it and give it instructions while it works.",
  background:
    "Hand a self-contained task to a separate agent with its own context. It runs in the background: this call returns at once, you can go on working, and its final answer arrives later as a message. Use for research or investigation that would otherwise fill this conversation. The person can watch it and give it instructions while it works.",
};

export default function (pi: any) {
  // Interrupt runs its children one after the other, even when the model asks
  // for two in one turn: two at once is two models at once.
  let queue: Promise<unknown> = Promise.resolve();
  // Background children still running, stopped with the session that started them.
  const detached = new Set<Run>();

  pi.on?.("session_shutdown", () => {
    for (const run of detached) run.stop();
  });

  /** Starts a child for the task and hands over what watching it needs. */
  function start(task: string, label: string, toolCallId: string, cwd: string, background: boolean, onUpdate?: any): Run {
    const id = randomUUID();
    // Its stderr goes nowhere: a pipe nobody reads fills, and the child
    // blocks on its next warning for good.
    const child = spawn(process.env.PI_SUBAGENT_BIN || "pi", ["--mode", "rpc", "--no-session"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    // A child that died, or never started, closes the pipe under the next
    // write. Unheard, that error takes down whatever runs this extension —
    // the portal, for everyone. As pi's own bash tool does: heard, and let go.
    child.stdin.on("error", () => {});
    const send = (command: Record<string, unknown>) => {
      if (child.stdin.writable) child.stdin.write(JSON.stringify(command) + "\n");
    };
    // Why it failed, when the child said.
    let failure: string | undefined;
    let answer = "";
    let steps = 0;
    // Stopped by the person in the portal, or by the parent's own stop: either
    // way what it has is not its whole answer.
    let stopped = false;
    const stop = () => {
      stopped = true;
      send({ type: "abort" });
    };
    const off = [
      pi.events.on(INPUT, (d: any) => d?.id === id && typeof d.text === "string" && send({ type: "steer", message: d.text })),
      pi.events.on(STOP, (d: any) => d?.id === id && stop()),
    ];
    pi.events.emit(START, { id, label, toolCallId, input: true, stop: true, detail: "Starting", ...(background ? { detached: true } : {}) });

    const status = new Promise<Status>((resolve) => {
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        // The task refused — no model, no key: no run follows, so nothing
        // would ever settle it, and the child would wait on its input for good.
        if (event.type === "response") {
          if (event.command === "prompt" && event.success === false) {
            failure = String(event.error ?? "The subagent refused the task");
            resolve("error");
          }
          return;
        }
        pi.events.emit(EVENT, { id, event });
        if (event.type === "tool_execution_start") {
          steps++;
          onUpdate?.({ content: [{ type: "text", text: answer }], details: { phase: `${event.toolName} (${steps} steps)` } });
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = (event.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (text) answer = text;
          onUpdate?.({ content: [{ type: "text", text: answer }], details: { phase: "thinking" } });
        }
        // Settled, not ended: pi ends a run and then retries it, or compacts
        // and goes on, and only settles once it has nothing left to do.
        if (event.type === "agent_settled") resolve(stopped ? "stopped" : "done");
      });
      child.on("exit", (code) => resolve(stopped ? "stopped" : code === 0 ? "done" : "error"));
      child.on("error", () => resolve("error"));
      send({ type: "prompt", message: task });
    });

    const finished = status.then((status) => {
      child.kill();
      off.forEach((f: () => void) => f());
      pi.events.emit(END, { id, status, ...(failure ? { error: failure } : {}) });
      return { status, answer, ...(failure ? { failure } : {}) };
    });
    return { id, finished, stop };
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: DESCRIPTIONS[subagentMode()],
    parameters: Type.Object({
      task: Type.String({ description: "The whole task, with everything the subagent needs to know — it sees nothing of this conversation" }),
      label: Type.Optional(Type.String({ description: "A short name for it, e.g. 'Research: vector DBs'" })),
    }),

    async execute(toolCallId: string, params: { task: string; label?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const label = params.label?.trim() || "Subagent";

      if (subagentMode() === "background") {
        const run = start(params.task, label, toolCallId, ctx.cwd, true);
        detached.add(run);
        void run.finished.then(({ status, answer, failure }) => {
          detached.delete(run);
          const said =
            status === "done"
              ? `Subagent "${label}" finished:\n\n${answer || "(it gave no answer)"}`
              : status === "stopped"
                ? `Subagent "${label}" was stopped before it finished.${answer ? ` What it had so far:\n\n${answer}` : ""}`
                : `Subagent "${label}" failed: ${failure ?? (answer ? "it ended early" : "it could not run — is `pi` on PATH? (PI_SUBAGENT_BIN)")}${answer ? `\n\nWhat it had so far:\n\n${answer}` : ""}`;
          try {
            // Its answer is what the parent was waiting for: a turn of its own
            // once the parent is free. A stop was the person's doing, and waits
            // for whatever they say next.
            pi.sendMessage(
              { customType: "subagent", content: said, display: true, details: { id: run.id, status } },
              status === "stopped" ? { deliverAs: "nextTurn" } : { deliverAs: "followUp", triggerTurn: true },
            );
          } catch {
            // The session it belonged to is gone: nobody is left to tell.
          }
        });
        return {
          content: [{ type: "text", text: `Started subagent "${label}" in the background. Its answer will arrive as a message when it is done; go on with other work meanwhile.` }],
          details: { phase: "background", id: run.id },
        };
      }

      // One at a time: wait for the one before, unless the parent is stopped meanwhile.
      const before = queue;
      let release!: () => void;
      queue = new Promise<void>((r) => (release = r));
      try {
        await Promise.race([before, new Promise((r) => signal?.addEventListener("abort", r, { once: true }))]);
        if (signal?.aborted) return { content: [{ type: "text", text: "(stopped before the subagent started)" }], details: { phase: "stopped" } };

        const run = start(params.task, label, toolCallId, ctx.cwd, false, onUpdate);
        const stopped = () => run.stop();
        signal?.addEventListener("abort", stopped, { once: true });
        const { status, answer, failure } = await run.finished;
        signal?.removeEventListener("abort", stopped);
        if (failure) throw new Error(`The subagent could not start: ${failure}`);
        if (status === "error" && !answer) throw new Error("The subagent could not run — is `pi` on PATH? (PI_SUBAGENT_BIN)");
        return { content: [{ type: "text", text: answer || "(the subagent gave no answer)" }], details: { phase: status } };
      } finally {
        release();
      }
    },
  });
}
