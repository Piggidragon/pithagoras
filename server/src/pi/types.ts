import type { EventEmitter } from "node:events";
import type { ImageContent } from "../prompt-images.js";

export interface PiState {
  model: {
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    /** What the model takes: "text", and "image" if it can see pictures. Unknown when left out. */
    input?: string[];
  };
  thinkingLevel: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
}

export interface PiStats {
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number };
  cost: number;
  /**
   * `tokens` and `percent` are null just after a compaction: the last count
   * was taken before it, and pi will not guess until the next reply.
   */
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null };
  toolCalls: number;
  totalMessages: number;
}

/** A tool a session could use, and where it came from. */
export interface PiTool {
  name: string;
  description?: string;
  /** The package or file that registered it, for grouping. */
  source: string;
  /** False when this conversation has it switched off. */
  enabled: boolean;
  /** Whether it is on by default, so the page can say where a chat disagrees. */
  defaultOn?: boolean;
  /**
   * Something other than the tool policy decides this one.
   *
   * "browser" for the tools the agent's browser brings: they follow the grant
   * the globe beside the composer sets, not the switches here.
   */
  owner?: "browser";
}

/**
 * What pi did with a message it took: queued it into the run that is going —
 * `text` is the words as pi queued them, a template or skill expanded and an
 * input handler's rewrite applied, which is what the message is when the agent
 * reads it — started a run with it, or had an extension handle it outright.
 */
export type PromptTaken =
  | { outcome: "queued"; lane: "steering" | "followUp"; text: string }
  | { outcome: "started" }
  | { outcome: "handled" };

export interface PiCommand {
  name: string;
  description?: string;
  source: string;
}

/**
 * What the portal needs from a pi session, regardless of how it is reached.
 *
 * Two implementations exist because the two executors are genuinely different
 * situations: the host executor runs pi in this process via the SDK, while the
 * container executor talks to pi inside another container, where only the RPC
 * protocol can reach.
 */
export interface PiClient extends EventEmitter {
  readonly running: boolean;
  /**
   * Speak to a subagent an extension announced over the subagent protocol
   * (see subagent-protocol.ts). False when this executor cannot reach the
   * extensions' event bus. Optional: only the in-process client can.
   */
  subagentInput?(id: string, text: string): boolean;
  subagentStop?(id: string): boolean;
  /**
   * pi's session file for this conversation, once it exists. Recorded by the
   * portal so the same conversation is reopened after a restart instead of a
   * new one being started. Undefined for executors that cannot report it.
   */
  readonly sessionFile?: string;

  /**
   * `steer` delivers a message sent mid-run into that run instead of after it.
   * Resolves once pi has taken the message, with what it did with it where the
   * executor can tell: see PromptTaken.
   */
  prompt(
    message: string,
    options?: { voice?: boolean; images?: ImageContent[]; steer?: boolean },
  ): Promise<PromptTaken | void>;
  abort(): Promise<void>;
  /**
   * Whether the agent has stopped for good — not merely between turns.
   * Optional: an executor that cannot see inside pi leaves it out, and
   * the run's own lifecycle events are then the only signal.
   */
  isIdle?(): boolean;
  /**
   * Drops the messages sent mid-run that the agent has not taken in yet.
   * Stopping a run leaves them queued otherwise, and they are slipped into
   * whatever runs next. Optional, like isIdle. Returns the words of what it
   * dropped, as pi had queued them.
   */
  clearQueue?(): string[];
  dispose(): void;

  getState(): Promise<PiState>;
  getStats(): Promise<PiStats>;
  getThinkingLevels(): Promise<string[]>;
  getModels(): Promise<PiState["model"][]>;
  getCommands(): Promise<PiCommand[]>;
  /**
   * Every tool this session could use, and whether it is on.
   * Optional: an executor that cannot ask pi leaves it out.
   */
  getTools?(): Promise<PiTool[]>;
  /** Switch tools off by name. Everything not named is on. */
  setToolsOff?(names: string[]): Promise<void>;

  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  /** Re-read pi's settings file. Optional: not every executor can. */
  refreshSettings?(): Promise<void>;
  /** Take up a changed context limit for the current model. Optional, like the above. */
  applyContextLimit?(): void;
  setAutoRetry(enabled: boolean): Promise<void>;
  compact(): Promise<void>;
  reload(): Promise<void>;
  /** Write the session to disk; returns the file path. */
  exportSession(target?: string): Promise<string>;

  /** Answer an extension dialog. Returns false if the request is unknown/expired. */
  respondUi(id: string, response: { cancelled?: boolean; value?: unknown }): boolean;
}
