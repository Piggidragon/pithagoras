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
 * PI_SUBAGENT_BIN picks the pi to run (default: `pi` on PATH).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Type } from "typebox";

const START = "subagent:v1:start";
const EVENT = "subagent:v1:event";
const END = "subagent:v1:end";
const INPUT = "subagent:v1:input";
const STOP = "subagent:v1:stop";

export default function (pi: any) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Hand a self-contained task to a separate agent with its own context, and get its final answer back. Use for research or investigation that would otherwise fill this conversation. The person can watch it and give it instructions while it works.",
    parameters: Type.Object({
      task: Type.String({ description: "The whole task, with everything the subagent needs to know — it sees nothing of this conversation" }),
      label: Type.Optional(Type.String({ description: "A short name for it, e.g. 'Research: vector DBs'" })),
    }),

    async execute(toolCallId: string, params: { task: string; label?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const id = randomUUID();
      const label = params.label?.trim() || "Subagent";
      const child = spawn(process.env.PI_SUBAGENT_BIN || "pi", ["--mode", "rpc", "--no-session"], {
        cwd: ctx.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const send = (command: Record<string, unknown>) => child.stdin.write(JSON.stringify(command) + "\n");

      let answer = "";
      let steps = 0;
      // Stopped by the person in the portal, or by the parent's own stop: either
      // way what it has is not its whole answer.
      let stoppedHere = false;
      const wasStopped = () => stoppedHere || signal?.aborted === true;
      const off = [
        pi.events.on(INPUT, (d: any) => d?.id === id && typeof d.text === "string" && send({ type: "steer", message: d.text })),
        pi.events.on(STOP, (d: any) => {
          if (d?.id !== id) return;
          stoppedHere = true;
          send({ type: "abort" });
        }),
      ];
      pi.events.emit(START, { id, label, toolCallId, input: true, stop: true, detail: "Starting" });

      const stopped = () => send({ type: "abort" });
      signal?.addEventListener("abort", stopped, { once: true });

      const status = await new Promise<"done" | "error" | "stopped">((resolve) => {
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.type === "response") return;
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
          if (event.type === "agent_settled") resolve(wasStopped() ? "stopped" : "done");
        });
        child.on("exit", (code) => resolve(wasStopped() ? "stopped" : code === 0 ? "done" : "error"));
        child.on("error", () => resolve("error"));
        send({ type: "prompt", message: params.task });
      });

      child.kill();
      signal?.removeEventListener("abort", stopped);
      off.forEach((f: () => void) => f());
      pi.events.emit(END, { id, status });
      if (status === "error" && !answer) throw new Error("The subagent could not run — is `pi` on PATH? (PI_SUBAGENT_BIN)");
      return { content: [{ type: "text", text: answer || "(the subagent gave no answer)" }], details: { phase: status } };
    },
  });
}
