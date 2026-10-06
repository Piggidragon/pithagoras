import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { recordAudit } from "../db.js";
import {
  CLOSE,
  CODE,
  CONNECT_PATH,
  DeviceError,
  FRAME,
  MAX_APPROVALS,
  MAX_CALLS,
  MAX_CHUNK,
  MAX_FILE,
  MAX_MESSAGE,
  PROTO_VERSION,
  decodeFrame,
  encodeFrame,
  readApproval,
  readAudit,
  readDeviceInfo,
  readExecExit,
  readHello,
  readPolicy,
  type ApprovalInfo,
  type Choice,
  type Ctx,
  type DeviceInfo,
  type ExecExit,
  type Hello,
  type PolicyDocument,
} from "./protocol.js";
import { deviceOfToken, devicesEnabled, devicesOffBecause, getDevice, touchDevice } from "./store.js";

/**
 * The portal's end of Pithagoras Sync: one WebSocket per paired device, which
 * the device opens (`/sync/v1/connect`, docs/guide/devices.md), and the calls the
 * portal makes on it.
 *
 * Who may connect is decided before the upgrade, from the connector token in
 * the Authorization header, and nothing else: not a cookie, which a page of
 * another site could make a browser send, and so not from a browser at all. A
 * request that names an Origin is a browser's and is refused, whatever it
 * carries. One live connection per device: a second is refused (409) and said
 * on the Devices page, so a copied token cannot push the real device off.
 *
 * Nothing is resumed. When a connection ends, every call waiting on it fails at
 * once and the device kills every command it ran for it (protocol.md, 4).
 */

const HELLO_WITHIN_MS = 10_000;
const PING_EVERY_MS = 20_000;
/** Nothing at all for this long, not even a pong, and the connection is dead. */
const DEAD_AFTER_MS = 45_000;
/** Most calls answer at once; one may wait for the owner's approval, which the device gives up on after at most an hour. */
const CALL_TIMEOUT_MS = 65 * 60_000;
const QUICK_TIMEOUT_MS = 30_000;

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  /** Given up on by the portal (stopped, timed out): see abandon. */
  abandoned: boolean;
  /** The stream a read, a write or a command uses. */
  stream?: number;
}

/** What a stream's binary frames go to. */
interface Sink {
  kind: number;
  next: number;
  take(payload: Buffer): void;
  fail(e: Error): void;
}

export interface Waiting {
  /** Approvals the device asks for while this call waits on one. */
  onApproval?: (approval: ApprovalInfo) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const offline = () => new DeviceError(CODE.IO, "the device disconnected");

/** One live connection, from the hello on. */
export class DeviceLink extends EventEmitter {
  readonly connectedAt = Date.now();
  /** device.info, asked once the connection is up; refreshed when the policy changes. */
  info?: DeviceInfo;
  /** Whether the device sees the portal's own files as the same user: then it is offered nothing (the same-machine check). */
  sameMachine?: boolean;
  /** The settings it shares, when its owner lets the portal read them. */
  policy?: PolicyDocument;
  /** Approvals it is waiting on, by its own id. */
  readonly approvals = new Map<number, ApprovalInfo>();
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private nextStream = 1;
  private readonly sinks = new Map<number, Sink>();
  private readonly exits = new Map<number, (exit: ExecExit) => void>();
  private lastHeard = Date.now();
  private readonly pinger: NodeJS.Timeout;
  closed = false;

  constructor(
    private readonly ws: WebSocket,
    readonly deviceId: string,
    readonly hello: Hello,
  ) {
    super();
    this.setMaxListeners(0);
    ws.on("message", (data, isBinary) => this.receive(data, isBinary));
    ws.on("pong", () => (this.lastHeard = Date.now()));
    ws.on("close", () => this.ended());
    this.pinger = setInterval(() => {
      if (Date.now() - this.lastHeard > DEAD_AFTER_MS) return void ws.terminate();
      ws.ping();
    }, PING_EVERY_MS);
    this.pinger.unref();
  }

  can(capability: string): boolean {
    return this.hello.capabilities.includes(capability);
  }

  /** A request, answered by the device; the result as it sent it. */
  call(method: string, params: Record<string, unknown>, waiting: Waiting = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(offline());
    if (this.pending.size >= MAX_CALLS) return Promise.reject(new DeviceError(CODE.BUSY, "too many calls to the device at once"));
    if (waiting.signal?.aborted) return Promise.reject(new DeviceError(CODE.INTERNAL, "stopped"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(entry.timer);
        waiting.signal?.removeEventListener("abort", stop);
        if (waiting.onApproval) this.off(`approval:${id}`, waiting.onApproval);
      };
      const entry: Pending = {
        method,
        resolve: (r) => { done(); resolve(r); },
        reject: (e) => { done(); reject(e); },
        timer: setTimeout(() => this.abandon(id, new DeviceError(CODE.IO, `the device did not answer ${method} in time`)), waiting.timeoutMs ?? CALL_TIMEOUT_MS),
        abandoned: false,
        stream: typeof params.stream === "number" ? params.stream : undefined,
      };
      const stop = () => this.abandon(id, new DeviceError(CODE.INTERNAL, "stopped"));
      waiting.signal?.addEventListener("abort", stop, { once: true });
      if (waiting.onApproval) this.on(`approval:${id}`, waiting.onApproval);
      this.pending.set(id, entry);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.closed) this.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * Stops waiting for a call. There is no way to take a call back from the
   * device, so what it would still do is stopped instead: an approval it waits
   * on for this call is denied, and a command it starts late is killed (see
   * the response handling).
   */
  private abandon(id: number, why: Error): void {
    const entry = this.pending.get(id);
    if (!entry || entry.abandoned) return;
    entry.abandoned = true;
    entry.reject(why);
    for (const approval of this.approvals.values()) {
      if (approval.call === id) this.answerApproval(approval.id, "deny").catch(() => {});
    }
    // Kept until the device answers, so that a late answer is known as this call's.
  }

  /** The owner's answer to an approval, sent to the device. */
  answerApproval(id: number, answer: Choice, minutes?: number): Promise<unknown> {
    return this.call("approval.answer", { id, answer, ...(answer === "time" ? { minutes } : {}) }, { timeoutMs: QUICK_TIMEOUT_MS });
  }

  /** A file's content, from FileData frames and the result that follows them. */
  async readFile(filePath: string, ctx: Ctx, waiting: Waiting = {}): Promise<{ data: Buffer; sha256: string }> {
    const stream = this.openStream();
    const chunks: Buffer[] = [];
    let size = 0;
    let failed: Error | undefined;
    this.sinks.set(stream, {
      kind: FRAME.fileData,
      next: 0,
      take: (payload) => {
        size += payload.length;
        if (size > MAX_FILE) failed ??= new DeviceError(CODE.TOO_LARGE, "the file is larger than the portal reads");
        else chunks.push(payload);
      },
      fail: (e) => (failed ??= e),
    });
    try {
      const result = (await this.call("fs.read", { path: filePath, stream, ctx }, waiting)) as { size?: unknown; sha256?: unknown; chunks?: unknown };
      if (failed) throw failed;
      const data = Buffer.concat(chunks);
      const sha256 = createHash("sha256").update(data).digest("hex");
      if (result?.size !== data.length || result?.sha256 !== sha256 || result?.chunks !== chunks.length) {
        throw new DeviceError(CODE.IO, "the file arrived incomplete");
      }
      return { data, sha256 };
    } finally {
      this.sinks.delete(stream);
    }
  }

  /** Writes a file: the request, then its content in FileUpload frames, each sent once the last has gone out. */
  async writeFile(filePath: string, data: Buffer, opts: { ifMatch?: string; createDirs?: boolean }, ctx: Ctx, waiting: Waiting = {}): Promise<{ size: number; sha256: string }> {
    if (data.length > MAX_FILE) throw new DeviceError(CODE.TOO_LARGE, "the file is larger than a device takes");
    const stream = this.openStream();
    const answer = this.call(
      "fs.write",
      { path: filePath, stream, size: data.length, ...(opts.ifMatch ? { if_match: opts.ifMatch } : {}), ...(opts.createDirs ? { create_dirs: true } : {}), ctx },
      waiting,
    );
    // The answer may come before every frame went out (a refusal): it is what counts then.
    let refused = false;
    answer.catch(() => (refused = true));
    for (let seq = 0, at = 0; at < data.length && !refused && !this.closed; seq++, at += MAX_CHUNK) {
      await this.sendBinary(encodeFrame(FRAME.fileUpload, stream, seq, data.subarray(at, at + MAX_CHUNK))).catch(() => {});
    }
    return (await answer) as { size: number; sha256: string };
  }

  /**
   * Runs a command: `exec.start`, its output as it comes, and its end. The
   * command runs in the device's own environment; nothing of the portal's is sent.
   */
  async exec(opts: { command: string; cwd: string; timeoutMs?: number; ctx: Ctx; onData: (data: Buffer) => void } & Waiting): Promise<ExecExit> {
    const stream = this.openStream();
    let ended: (exit: ExecExit) => void = () => {};
    const exit = new Promise<ExecExit>((resolve) => (ended = resolve));
    this.sinks.set(stream, { kind: FRAME.execOutput, next: 0, take: opts.onData, fail: () => {} });
    this.exits.set(stream, ended);
    let started = false;
    const stop = () => {
      if (started) this.notifySignal(stream, "SIGTERM");
    };
    let onClosed = () => {};
    try {
      await this.call(
        "exec.start",
        { stream, command: opts.command, cwd: opts.cwd, ...(opts.timeoutMs ? { timeout_ms: Math.round(opts.timeoutMs) } : {}), ctx: opts.ctx },
        { onApproval: opts.onApproval, signal: opts.signal },
      );
      started = true;
      if (opts.signal?.aborted) stop();
      opts.signal?.addEventListener("abort", stop, { once: true });
      const lost = new Promise<never>((_, reject) => {
        onClosed = () => reject(offline());
        if (this.closed) onClosed();
        else this.once("closed", onClosed);
      });
      return await Promise.race([exit, lost]);
    } finally {
      this.off("closed", onClosed);
      opts.signal?.removeEventListener("abort", stop);
      this.sinks.delete(stream);
      this.exits.delete(stream);
    }
  }

  private notifySignal(stream: number, signal: "SIGINT" | "SIGTERM" | "SIGKILL"): void {
    this.call("exec.signal", { stream, signal }, { timeoutMs: QUICK_TIMEOUT_MS }).catch(() => {});
  }

  /** A stream id no open read, write or command of this connection uses. */
  private openStream(): number {
    for (;;) {
      const id = this.nextStream;
      this.nextStream = this.nextStream >= 0xfffffffe ? 1 : this.nextStream + 1;
      if (!this.sinks.has(id) && !this.exits.has(id)) return id;
    }
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) this.ws.close(code, reason);
    // A device that does not answer the close is not waited for.
    setTimeout(() => this.ws.terminate(), 2000).unref();
    this.ended();
  }

  private send(message: object): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendBinary(frame: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== this.ws.OPEN) return reject(offline());
      this.ws.send(frame, { binary: true }, (e) => (e ? reject(e) : resolve()));
    });
  }

  private receive(data: RawData, isBinary: boolean): void {
    this.lastHeard = Date.now();
    const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (isBinary) return this.receiveFrame(buffer);
    let message: any;
    try {
      message = JSON.parse(buffer.toString("utf8"));
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
    if (typeof message.method === "string") return this.receiveNotification(message.method, message.params);
    if (typeof message.id !== "number") {
      // The device says the portal sent something it could not read: a bug here, worth a line in the log (never the frame).
      // Quoted, as it is the device's own text: a line break in it could otherwise write a line of the log.
      if (message.error) console.warn(`[devices] ${this.deviceId} refused a frame: ${JSON.stringify(String(message.error?.message ?? "").slice(0, 200))}`);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (entry.abandoned) {
      // Started after all, for a call nobody waits for any more: it is stopped at once.
      if (entry.method === "exec.start" && !message.error && entry.stream !== undefined) this.notifySignal(entry.stream, "SIGKILL");
      return;
    }
    if (message.error && typeof message.error === "object") {
      const code = Number.isInteger(message.error.code) ? message.error.code : CODE.INTERNAL;
      entry.reject(new DeviceError(code, String(message.error.message ?? "the device refused").slice(0, 2000), message.error.data));
    } else entry.resolve(message.result);
  }

  private receiveFrame(buffer: Buffer): void {
    const frame = decodeFrame(buffer);
    if (!frame) return;
    const sink = this.sinks.get(frame.stream);
    if (!sink || sink.kind !== frame.kind) return;
    if (frame.seq !== sink.next) return sink.fail(new DeviceError(CODE.IO, "frames arrived out of order"));
    sink.next++;
    sink.take(frame.payload);
  }

  /**
   * Whether a question the device asks is taken up. Each is kept, shown on the
   * Devices page and asked in a chat until it is answered, so what a device
   * can open is bounded: a number of them in all, none that repeats one it has,
   * none for a call of this connection that is not waiting, and one at a time
   * for a call, which waits on a single answer.
   */
  private keepsApproval(approval: ApprovalInfo): boolean {
    if (this.approvals.has(approval.id) || this.approvals.size >= MAX_APPROVALS) return false;
    if (typeof approval.call !== "number") return true;
    if (!this.pending.has(approval.call)) return false;
    for (const open of this.approvals.values()) if (open.call === approval.call) return false;
    return true;
  }

  private receiveNotification(method: string, params: unknown): void {
    switch (method) {
      case "exec.exit": {
        const exit = readExecExit(params);
        if (exit) this.exits.get(exit.stream)?.(exit);
        return;
      }
      case "approval.requested": {
        const approval = readApproval(params);
        if (!approval || !this.keepsApproval(approval)) return;
        this.approvals.set(approval.id, approval);
        // Asked for a call the portal has stopped waiting for: nobody is there to answer it.
        const waiting = typeof approval.call === "number" ? this.pending.get(approval.call) : undefined;
        if (waiting?.abandoned) {
          this.answerApproval(approval.id, "deny").catch(() => {});
          return;
        }
        if (typeof approval.call === "number") this.emit(`approval:${approval.call}`, approval);
        hub.emit("approval", this.deviceId, approval);
        return;
      }
      case "approval.resolved": {
        const id = typeof (params as any)?.id === "number" ? (params as any).id : undefined;
        if (id === undefined) return;
        const was = this.approvals.get(id);
        this.approvals.delete(id);
        if (was) hub.emit("approval-resolved", this.deviceId, was);
        return;
      }
      case "audit": {
        const event = readAudit(params);
        if (!event) return;
        recordAudit({
          kind: "device",
          tool: event.tool,
          subject: event.target,
          reason: `${getDevice(this.deviceId)?.name ?? this.deviceId}: ${event.decision}${event.reason ? ` — ${event.reason}` : ""}`,
          sessionId: event.chat,
        });
        return;
      }
      case "policy.changed": {
        const policy = readPolicy(params);
        if (!policy) return;
        this.policy = policy;
        // The mode, the folders and the tools are in device.info: read again so the page and the tools see them now.
        this.call("device.info", {}, { timeoutMs: QUICK_TIMEOUT_MS }).then((info) => {
          const read = readDeviceInfo(info);
          if (read) this.info = read;
          hub.emit("status", this.deviceId);
        }, () => {});
        return;
      }
      default:
        // A newer client may say more; nothing it says unasked is acted on.
        return;
    }
  }

  private ended(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    for (const [, entry] of this.pending) if (!entry.abandoned) entry.reject(offline());
    this.pending.clear();
    for (const sink of this.sinks.values()) sink.fail(offline());
    this.approvals.clear();
    this.emit("closed");
  }
}

// --- the registry ---

/** Says what changed: "status" (a device came, went or changed), "approval", "approval-resolved". */
export const hub = new EventEmitter();
hub.setMaxListeners(0);

const links = new Map<string, DeviceLink>();
/** Devices whose upgrade is under way, so that two at once cannot both get through the one-connection check. */
const arriving = new Set<string>();
/** A connection refused because the device already had one, by device: said on the Devices page. */
const alerts = new Map<string, { at: number; message: string }>();

export const linkOf = (deviceId: string): DeviceLink | undefined => links.get(deviceId);
export const alertOf = (deviceId: string) => alerts.get(deviceId);
export const clearAlert = (deviceId: string) => alerts.delete(deviceId);

/** Ends a device's connection now: removed (4001), or the add-on switched off (1001). */
export function dropDevice(deviceId: string, code: number = CLOSE.revoked, reason = "device removed"): void {
  links.get(deviceId)?.close(code, reason);
  links.delete(deviceId);
  if (code === CLOSE.revoked) alerts.delete(deviceId);
  hub.emit("status", deviceId);
}

export function dropAll(code: number = CLOSE.goingAway, reason = "the portal is going away"): void {
  for (const id of [...links.keys()]) dropDevice(id, code, reason);
}

/** An answer to a connection that does not become a WebSocket, then closed. */
function refuse(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  socket.end(`HTTP/1.1 ${status} ${http_status(status)}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  setTimeout(() => socket.destroy(), 5_000).unref();
}

const http_status = (status: number) =>
  ({ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 503: "Service Unavailable" })[status] ?? "Error";

/** Whether an upgrade is the sync connection's: only its exact path, without a query. */
export const isSyncUpgrade = (url: string | undefined): boolean => url === CONNECT_PATH;

/**
 * Who an upgrade is from: a device, or the status and words to refuse it with.
 * Checked before the upgrade, so that nothing unauthenticated ever becomes a
 * WebSocket.
 */
export function admit(headers: http.IncomingHttpHeaders): { deviceId: string } | { status: number; message: string } {
  if (!devicesEnabled()) return { status: 503, message: devicesOffBecause() };
  // A browser always names the page it opens a socket from; the device client never does.
  if (headers.origin !== undefined) return { status: 403, message: "Not from a browser" };
  const auth = headers.authorization ?? "";
  const token = /^Bearer ([\x21-\x7e]{16,512})$/.exec(auth)?.[1];
  const device = token ? deviceOfToken(token) : undefined;
  if (!device) return { status: 401, message: "Unknown or revoked token" };
  if (links.has(device.id) || arriving.has(device.id)) {
    alerts.set(device.id, { at: Date.now(), message: "A second connection with this device's token was refused while it was connected" });
    hub.emit("status", device.id);
    return { status: 409, message: "This device is already connected" };
  }
  return { deviceId: device.id };
}

/**
 * The sync WebSocket, on the portal's own HTTP server. Registered before the
 * browser's upgrade listener, which leaves this path alone.
 */
export function attachSyncUpgrade(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false, clientTracking: false });
  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isSyncUpgrade(req.url)) return;
    socket.on("error", () => {});
    if (req.method !== "GET") return refuse(socket, 400, "Bad request");
    const admitted = admit(req.headers);
    if ("status" in admitted) return refuse(socket, admitted.status, admitted.message);
    const { deviceId } = admitted;
    arriving.add(deviceId);
    wss.handleUpgrade(req, socket, head, (ws) => {
      // From the first byte on: a frame that breaks the protocol (unmasked, over the limit, bad UTF-8) is an
      // 'error' of the socket, which ends the whole process when nobody listens.
      ws.on("error", () => ws.terminate());
      welcome(ws, deviceId, () => arriving.delete(deviceId));
    });
    // handleUpgrade answers a malformed upgrade itself and never calls back.
    socket.once("close", () => arriving.delete(deviceId));
  });
}

/**
 * The first frame is the device's hello; then the link is up and the portal
 * asks what it needs to know. The link is made inside the hello's own
 * `message` handler: the socket may deliver the next frame in the same
 * breath, and a listener added later would not hear it.
 */
function welcome(ws: WebSocket, deviceId: string, settled: () => void): void {
  const refused = (code: number, reason: string) => {
    settled();
    ws.close(code, reason);
  };
  const late = setTimeout(() => {
    ws.off("message", first);
    refused(CLOSE.violation, "hello expected");
  }, HELLO_WITHIN_MS);
  const gone = () => {
    clearTimeout(late);
    ws.off("message", first);
    settled();
  };
  const first = (data: RawData, isBinary: boolean) => {
    clearTimeout(late);
    ws.off("close", gone);
    const hello = isBinary ? undefined : readFirst(data);
    if (hello === "proto") return refused(CLOSE.unsupported, "unsupported protocol version");
    if (!hello || hello.device_id !== deviceId) return refused(CLOSE.violation, "hello expected");
    // Removed while it said hello: it stops. The add-on switched off: it tries again, as it does for the switch.
    if (!getDevice(deviceId)) return refused(CLOSE.revoked, "device removed");
    if (!devicesEnabled()) return refused(CLOSE.goingAway, "devices switched off");
    const link = new DeviceLink(ws, deviceId, hello);
    links.set(deviceId, link);
    touchDevice(deviceId);
    link.once("closed", () => {
      if (links.get(deviceId) === link) links.delete(deviceId);
      if (getDevice(deviceId)) touchDevice(deviceId);
      hub.emit("status", deviceId);
    });
    settled();
    hub.emit("status", deviceId);
    void learn(link);
  };
  ws.once("message", first);
  ws.once("close", gone);
}

/** The hello's params, "proto" for another protocol version, or undefined when the frame is not a hello. */
function readFirst(data: RawData): Hello | "proto" | undefined {
  try {
    const m = JSON.parse(String(data));
    if (m?.jsonrpc !== "2.0" || m.method !== "hello" || "id" in m) return undefined;
    const hello = readHello(m.params);
    return hello && hello.proto !== PROTO_VERSION ? "proto" : hello;
  } catch {
    return undefined;
  }
}

/** What the portal asks a device once it is connected: what it is, whether it is the portal's own machine, its approvals and its settings. */
async function learn(link: DeviceLink): Promise<void> {
  try {
    const info = readDeviceInfo(await link.call("device.info", {}, { timeoutMs: QUICK_TIMEOUT_MS }));
    if (info) link.info = info;
    link.sameMachine = await sameMachine(link);
    if (link.can("approvals")) {
      const listed = (await link.call("approval.list", {}, { timeoutMs: QUICK_TIMEOUT_MS })) as { approvals?: unknown[] };
      for (const a of Array.isArray(listed?.approvals) ? listed.approvals.slice(0, MAX_APPROVALS) : []) {
        const approval = readApproval(a);
        if (approval) link.approvals.set(approval.id, approval);
      }
    }
    if (link.can("policy")) link.policy = readPolicy(await link.call("policy.get", {}, { timeoutMs: QUICK_TIMEOUT_MS }).catch(() => undefined));
  } catch {
    // A device that does not answer these is still connected; it is offered nothing until it has said what it is.
  }
  hub.emit("status", link.deviceId);
}

/**
 * The same-machine check (architecture, section 4): a random file in the
 * portal's temp folders, and whether the device reads the same content there
 * as the same user. Such a device would reach nothing the portal's own tools
 * do not, so it is not offered for files or the shell.
 */
export async function sameMachine(link: DeviceLink): Promise<boolean> {
  const content = randomBytes(32).toString("hex");
  const sha = createHash("sha256").update(content).digest("hex");
  const me = os.userInfo();
  const dirs = [...new Set([os.tmpdir(), ...(process.platform === "win32" ? [] : ["/tmp"])])];
  for (const dir of dirs) {
    const file = path.join(dir, `pithagoras-probe-${randomBytes(16).toString("hex")}`);
    try {
      writeFileSync(file, content, { mode: 0o600, flag: "wx" });
      const answer = (await link.call("device.probe", { path: file }, { timeoutMs: QUICK_TIMEOUT_MS })) as { found?: unknown; sha256?: unknown; user?: unknown; uid?: unknown };
      if (answer?.found === true && answer.sha256 === sha && answer.uid === me.uid && answer.user === me.username) return true;
    } catch {
      // Not seen there, or not asked: nothing shared in that folder.
    } finally {
      rmSync(file, { force: true });
    }
  }
  return false;
}
