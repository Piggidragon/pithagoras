import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { getSetting, putSetting } from "./db.js";
import { pictureExt } from "./prompt-images.js";

/**
 * Image generation as an add-on: the agent's `generate_image` tool asks an
 * image model the person has set up for a picture, and gets one back.
 *
 * The endpoint speaks the OpenAI-style `images/generations` shape — a request
 * with a model and a prompt, an answer with a picture as base64 or as an
 * address — which hosted providers and local servers alike offer. The settings
 * are the portal's own, read each time the tool is called, so a change to the
 * address or the model needs no restart. The key is kept here and goes to the
 * endpoint it was given for, and nowhere else: not into a log, not into an
 * answer of the API (only whether one is set), and not to another host.
 */

const KEY = "image_generation";

export interface ImageGenerationConfig {
  enabled: boolean;
  /** The API's base, such as https://host/v1: no credentials, query or fragment, so that nothing secret is in what the page is shown. */
  baseUrl: string;
  /** Sent as `model` when it is not empty. */
  model: string;
  /** Sent as `size` when it is not empty, unless the agent asks for another. */
  size: string;
  apiKey: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function imageGenerationConfig(): ImageGenerationConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(getSetting(KEY) || "{}");
    if (parsed && typeof parsed === "object") raw = parsed;
  } catch {
    // Unreadable is as good as nothing saved.
  }
  return { enabled: raw.enabled === true, baseUrl: text(raw.baseUrl), model: text(raw.model), size: text(raw.size), apiKey: text(raw.apiKey) };
}

/** On, and told where to ask: only then is there a tool, so there is no tool that always fails. */
export const imageGenerationReady = (config: ImageGenerationConfig = imageGenerationConfig()): boolean => config.enabled && config.baseUrl !== "";

/** What the page is told of the settings: never the key itself. */
export function imageGenerationState() {
  const { apiKey, ...rest } = imageGenerationConfig();
  return { ...rest, keySet: apiKey !== "" };
}

export interface ImageGenerationPatch {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  size?: string;
  /** "" takes the saved one away. */
  apiKey?: string;
}

/** `1024x1024`, or `auto`, as the OpenAI-style APIs take it. */
export const SIZE = /^(auto|\d{2,5}x\d{2,5})$/;

/** What a request may change, checked; the reason when it may not. */
export function parseImageGenerationPatch(body: unknown): ImageGenerationPatch | string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: ImageGenerationPatch = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return "enabled must be true or false";
    patch.enabled = b.enabled;
  }
  if (b.baseUrl !== undefined) {
    if (typeof b.baseUrl !== "string") return "The address must be text";
    const given = b.baseUrl.trim();
    if (given) {
      let url: URL;
      try {
        url = new URL(given);
      } catch {
        return "The address must be an http or https URL";
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return "The address must be an http or https URL";
      if (url.username || url.password || url.search || url.hash) return "The address is the API's base, such as https://host/v1: the key goes in the key field, not in the address";
      patch.baseUrl = url.toString().replace(/\/+$/, "");
    } else {
      patch.baseUrl = "";
    }
  }
  if (b.model !== undefined) {
    if (typeof b.model !== "string" || b.model.length > 200) return "The model must be text of at most 200 characters";
    patch.model = b.model.trim();
  }
  if (b.size !== undefined) {
    if (typeof b.size !== "string" || (b.size.trim() && !SIZE.test(b.size.trim()))) return 'The size looks like "1024x1024"';
    patch.size = b.size.trim();
  }
  if (b.apiKey !== undefined) {
    if (typeof b.apiKey !== "string" || b.apiKey.length > 4000) return "The key must be text of at most 4000 characters";
    patch.apiKey = b.apiKey.trim();
  }
  return patch;
}

const originOf = (address: string): string => {
  try {
    return new URL(address).origin;
  } catch {
    return "";
  }
};

/**
 * Saves a change, or refuses it: switched on, there must be an address to ask.
 * A key belongs to the server it was given for, so a new address that does not
 * come with one has none.
 */
export function saveImageGeneration(patch: ImageGenerationPatch): ImageGenerationConfig {
  const had = imageGenerationConfig();
  const next = { ...had, ...patch };
  if (patch.apiKey === undefined && originOf(next.baseUrl) !== originOf(had.baseUrl)) next.apiKey = "";
  if (next.enabled && !next.baseUrl) throw new ImageGenerationError("Set the address of the image endpoint before switching it on");
  putSetting(KEY, JSON.stringify(next));
  return next;
}

/** What went wrong with a picture, in words the agent can pass on: nothing in it is secret. */
export class ImageGenerationError extends Error {}

/** After decoding: what the portal serves back as a picture, with room to spare. */
export const MAX_GENERATED_BYTES = 20 * 1024 * 1024;
/** Image models are slow, a local one more so. */
export const GENERATE_TIMEOUT_MS = 3 * 60_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface GenerateOptions {
  /** The chat being stopped. */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Where the request goes: the base, with the route the OpenAI-style APIs have unless it is already there. */
export function endpointUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const base = url.pathname.replace(/\/+$/, "");
  url.pathname = base.endsWith("/images/generations") ? base : `${base}/images/generations`;
  return url;
}

/** `message` without the key, in case the server repeated it. */
const without = (message: string, key: string): string => (key ? message.split(key).join("[key]") : message);

const seconds = (ms: number) => Math.round(ms / 1000);

/**
 * Asks for a picture and returns it, checked: what comes back is a PNG, JPEG,
 * GIF or WebP by its first bytes, whatever the server calls it, and not larger
 * than the limit.
 */
export async function generateImage(
  config: ImageGenerationConfig,
  request: { prompt: string; size?: string },
  options: GenerateOptions = {},
): Promise<{ bytes: Buffer; ext: string }> {
  const timeoutMs = options.timeoutMs ?? GENERATE_TIMEOUT_MS;
  const max = options.maxBytes ?? MAX_GENERATED_BYTES;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
  const endpoint = endpointUrl(config.baseUrl);
  const size = request.size || config.size;
  const body = JSON.stringify({ ...(config.model ? { model: config.model } : {}), prompt: request.prompt, n: 1, ...(size ? { size } : {}) });
  const failed = (e: unknown): Error => {
    // The chat was stopped: nobody is told it failed.
    if (options.signal?.aborted) return e as Error;
    if (signal.aborted) return new ImageGenerationError(`The image endpoint did not answer within ${seconds(timeoutMs)} seconds`);
    if (e instanceof ImageGenerationError) return e;
    const why = (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.message ?? "unknown error";
    return new ImageGenerationError(without(`Could not reach the image endpoint at ${endpoint.origin} (${why})`, config.apiKey));
  };

  try {
    // Never followed elsewhere: the key goes with this request, to this address.
    const res = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json", accept: "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body,
    });
    // The picture as base64 is a third larger than itself, and wrapped in JSON.
    const answer = await readBody(res.body, Math.ceil((max * 4) / 3) + 64 * 1024, "The image endpoint's answer");
    let parsed: any;
    try {
      parsed = JSON.parse(answer.toString("utf8"));
    } catch {
      if (!res.ok) throw new ImageGenerationError(`The image endpoint answered ${res.status}`);
      throw new ImageGenerationError("The image endpoint did not answer with JSON");
    }
    if (!res.ok) {
      const said = text(parsed?.error?.message) || text(parsed?.error) || text(parsed?.message);
      throw new ImageGenerationError(without(`The image endpoint answered ${res.status}${said ? `: ${said.replace(/\s+/g, " ").slice(0, 300)}` : ""}`, config.apiKey));
    }
    const first = Array.isArray(parsed?.data) ? parsed.data[0] : undefined;
    let bytes: Buffer;
    if (typeof first?.b64_json === "string" && first.b64_json) bytes = fromBase64(first.b64_json, max);
    else if (typeof first?.url === "string" && first.url.startsWith("data:")) bytes = fromBase64(first.url, max);
    else if (typeof first?.url === "string" && first.url) bytes = await download(first.url, endpoint, config.apiKey, signal, max);
    else throw new ImageGenerationError("The image endpoint answered, but with no picture in it");
    return picture(bytes, max);
  } catch (e) {
    throw failed(e);
  }
}

/** A picture, if these bytes are one. */
function picture(bytes: Buffer, max: number): { bytes: Buffer; ext: string } {
  if (bytes.length > max) throw new ImageGenerationError(`The picture is over ${max / 1024 / 1024} MB`);
  const ext = pictureExt(bytes.subarray(0, 12));
  if (!ext) throw new ImageGenerationError("What the image endpoint sent is not a PNG, JPEG, GIF or WebP picture");
  return { bytes, ext };
}

/** Base64, or a data: URL holding it, decoded; the size is worked out before anything large is. */
function fromBase64(given: string, max: number): Buffer {
  const comma = given.startsWith("data:") ? given.indexOf(",") : -1;
  const data = (comma >= 0 ? given.slice(comma + 1) : given).replace(/\s+/g, "");
  if (!data || !BASE64.test(data)) throw new ImageGenerationError("The picture the image endpoint sent is not base64");
  if (Math.floor((data.length * 3) / 4) > max + 3) throw new ImageGenerationError(`The picture is over ${max / 1024 / 1024} MB`);
  return Buffer.from(data, "base64");
}

/** A body read up to a limit, which is not read past. */
async function readBody(stream: ReadableStream<Uint8Array> | null, max: number, what: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  if (!stream) return Buffer.alloc(0);
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > max) throw new ImageGenerationError(`${what} is over ${Math.round(max / 1024 / 1024)} MB`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// --- a picture sent as an address ---

/** Not somewhere on the public internet: this machine, its network, the places that are reserved. */
const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) NOT_PUBLIC.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  NOT_PUBLIC.addSubnet(net, bits, "ipv6");
}

/** Whether `address`, as an IP address, is one on the public internet. Anything that is not an address is not. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (!family) return false;
  try {
    // An IPv4 address written the IPv6 way (::ffff:10.0.0.1) is judged as the IPv4 one.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
    return mapped ? !NOT_PUBLIC.check(mapped[1], "ipv4") : !NOT_PUBLIC.check(bare, family === 6 ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}

/**
 * Why a picture may not be fetched from `url`, or undefined when it may.
 *
 * The address comes from the endpoint, which the person chose to trust with
 * their prompts, but it names a place the endpoint picked: a signed link on a
 * storage service of the provider's, usually, and not the API's own host. So
 * two places are fetched from. The endpoint's own origin, which is the
 * person's own choice — a local server on this machine hands out its pictures
 * itself. And, over https, any host on the public internet. Never another place
 * on this machine or its network: an endpoint answering with
 * http://169.254.169.254/… or http://localhost:8080/admin would otherwise have
 * the portal fetch it. A host given by name is checked where it is connected
 * to (publicLookup); one given as an address, here.
 */
export function pictureUrlRefusal(url: URL, endpoint: URL): string | undefined {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The picture's address is not http or https";
  if (url.username || url.password) return "The picture's address has a login in it";
  if (url.origin === endpoint.origin) return undefined;
  if (url.protocol !== "https:") return `The picture is on ${url.host}, another host than the endpoint, and is only fetched from there over https`;
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname)) return `The picture is at ${url.host}, which is not on the public internet`;
  return undefined;
}

/** Connects only to public addresses: checked where the connection is made, so that a name cannot answer one way here and another there. */
const publicLookup = (host: string, options: dns.LookupOptions, callback: (...args: any[]) => void): void => {
  dns.lookup(host, { ...options, all: true }, (err, found) => {
    if (err) return callback(err);
    const addresses = found as dns.LookupAddress[];
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new ImageGenerationError(`The picture is on ${host}, which is not on the public internet`));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

const MAX_REDIRECTS = 3;

/** What is sent with a request for a picture: the key only to the endpoint's own origin, which is the server it was given for. */
export function downloadHeaders(url: URL, endpoint: URL, key: string): Record<string, string> {
  return { accept: "image/*", ...(url.origin === endpoint.origin && key ? { authorization: `Bearer ${key}` } : {}) };
}

/**
 * Fetches a picture from an address the endpoint gave. The key is sent only
 * to the endpoint's own origin, and each redirect is judged like the address
 * itself, so one cannot lead anywhere the address could not.
 */
function download(address: string, endpoint: URL, key: string, signal: AbortSignal, max: number, hops = 0, from: URL = endpoint): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(address, from);
    } catch {
      return reject(new ImageGenerationError("The picture's address is not an address"));
    }
    const refusal = pictureUrlRefusal(url, endpoint);
    if (refusal) return reject(new ImageGenerationError(refusal));
    const own = url.origin === endpoint.origin;
    const get = url.protocol === "https:" ? https.get : http.get;
    const req = get(
      url,
      {
        signal,
        // A connection of its own, so what is known of one host is never taken for another's.
        agent: false,
        headers: downloadHeaders(url, endpoint, key),
        ...(own ? {} : { lookup: publicLookup }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const next = res.headers.location;
        if (status >= 300 && status < 400 && next) {
          res.resume();
          if (hops >= MAX_REDIRECTS) return reject(new ImageGenerationError("The picture's address redirects too often"));
          return void download(next, endpoint, key, signal, max, hops + 1, url).then(resolve, reject);
        }
        if (status !== 200) {
          res.resume();
          return reject(new ImageGenerationError(`The picture's address answered ${status}`));
        }
        if (Number(res.headers["content-length"]) > max) {
          res.destroy();
          return reject(new ImageGenerationError(`The picture is over ${max / 1024 / 1024} MB`));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > max) {
            res.destroy();
            reject(new ImageGenerationError(`The picture is over ${max / 1024 / 1024} MB`));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
        res.on("close", () => {
          if (!res.complete) reject(new ImageGenerationError("The picture's download ended early"));
        });
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof ImageGenerationError || signal.aborted) return reject(e);
      reject(new ImageGenerationError(`Could not download the picture from ${url.host} (${e.code ?? e.message})`));
    });
  });
}
