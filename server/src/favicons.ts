import net from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Site icons for the sources list, fetched by the portal rather than the page.
 *
 * The icons make a list of links recognisable at a glance, and the obvious way
 * to get them — pointing an <img> at each site — is the wrong one. It would
 * have the reader's browser knock on every domain the agent cited, from the
 * reader's own address, at the moment a conversation is opened: every one of
 * those sites learns who read it and when, and a favicon is a normal request
 * that can set a cookie. A third-party icon service is no better; it learns the
 * whole list at once.
 *
 * The portal already visited those pages, so it is the one party that learns
 * nothing new by asking for the icon. It fetches, caches, and hands the page
 * bytes from its own origin.
 */

const TIMEOUT_MS = 5_000;
/** A redirect is the site choosing the next address, so each one is checked again. */
const MAX_REDIRECTS = 3;
/** An icon is a few kilobytes. Anything this big is not one. */
const MAX_BYTES = 256 * 1024;
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Remembered too, or a site without an icon is asked again on every render. */
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Icon {
  body: Buffer;
  type: string;
}

interface Entry {
  icon: Icon | null;
  until: number;
}

/**
 * Where a name is looked up.
 *
 * Behind a handle so a test can answer for it: what this module has to get
 * right is what it does with an address, and proving that should not depend on
 * a resolver, a network, or a domain somebody has to keep registered.
 */
export const dns = { lookup };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Icon | null>>();

/**
 * A hostname and nothing else.
 *
 * What arrives is a domain read out of a tool's output, which is to say text
 * the agent was handed by a web page. It is used to build a URL the server
 * fetches, so it has to be a name — not a host with a port, not credentials,
 * not a path smuggled through.
 */
export function validDomain(domain: string): boolean {
  if (!domain || domain.length > 253 || !domain.includes(".")) return false;
  if (!/^[a-z0-9.-]+$/i.test(domain)) return false;
  if (domain.startsWith(".") || domain.startsWith("-") || domain.includes("..")) return false;
  // An address is not a site. This is shape only — where the name actually
  // points is a separate question, asked in publicHost().
  if (net.isIP(domain)) return false;
  return !/(^|\.)(localhost|local|internal|localdomain)$/i.test(domain);
}

/**
 * Whether a name points somewhere on the public internet.
 *
 * The domain comes out of a tool's output, which is to say out of a web page
 * the agent was handed, and one request goes out per cited domain the moment a
 * transcript is drawn. Rejecting the shape of an address is not enough:
 * `127.0.0.1.nip.io` and `localtest.me` are ordinary public names that resolve
 * to the loopback, and an internal corporate name looks like any other. So the
 * name is resolved and every address it gives back has to be one the portal
 * could have reached from outside its own network.
 *
 * What this does not close is a name that answers differently the second time
 * it is asked — the address checked here is not provably the address connected
 * to. Closing that needs the connection pinned to the address, which is a
 * bigger change than a site icon is worth; the redirect check and the
 * image-only reply are what stand behind it.
 */
export async function publicHost(hostname: string): Promise<boolean> {
  if (!validDomain(hostname)) return false;
  try {
    const found = await dns.lookup(hostname, { all: true, verbatim: true });
    return found.length > 0 && found.every((a) => publicAddress(a.address));
  } catch {
    return false;
  }
}

/** Everything that is not somewhere else on the internet. */
export function publicAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) return publicV4(address);
  if (kind === 6) return publicV6(address.toLowerCase());
  return false;
}

function publicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // 192.0.0/24 and the documentation ranges
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast and reserved
  return true;
}

function publicV6(address: string): boolean {
  if (address === "::" || address === "::1") return false;
  // An IPv4 address wearing an IPv6 hat is still that address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return publicV4(mapped[1]);
  const head = address.split(":")[0];
  if (/^f[cd]/.test(head)) return false; // unique-local
  if (/^fe[89ab]/.test(head)) return false; // link-local
  if (/^ff/.test(head)) return false; // multicast
  return true;
}

export async function favicon(domain: string): Promise<Icon | null> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.icon;

  const running = inflight.get(key);
  if (running) return running;

  const attempt = fetchIcon(key)
    .catch(() => null)
    .then((icon) => {
      remember(key, icon);
      inflight.delete(key);
      return icon;
    });
  inflight.set(key, attempt);
  return attempt;
}

function remember(key: string, icon: Icon | null): void {
  // Oldest out first. The map keeps insertion order, and a transcript only
  // ever wants the handful of domains on the screen.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { icon, until: Date.now() + (icon ? OK_TTL_MS : MISS_TTL_MS) });
}

async function fetchIcon(domain: string): Promise<Icon | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = `https://${domain}/favicon.ico`;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = new URL(url);
      if (target.protocol !== "https:" && target.protocol !== "http:") return null;
      if (!(await publicHost(target.hostname))) return null;

      // Followed by hand, because following automatically hands the choice of
      // the next address to the site — a redirect to something inside the
      // portal's network would be taken without anyone looking at it.
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept: "image/*" },
      });

      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) return null;
        url = new URL(next, url).href;
        continue;
      }
      if (!res.ok) return null;

      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      // Sites answer a missing icon with their 200-page rather than a 404 more
      // often than not, and an HTML page drawn as an icon is a broken image.
      if (!type.startsWith("image/")) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length || body.length > MAX_BYTES) return null;
      return { body, type };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
