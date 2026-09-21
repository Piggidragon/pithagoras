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
  // An address is not a site, and the ones worth blocking are the ones inside
  // the network the portal runs in.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;
  return !/(^|\.)(localhost|local|internal|localdomain)$/i.test(domain);
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
    const res = await fetch(`https://${domain}/favicon.ico`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // Sites answer a missing icon with their 200-page rather than a 404 more
    // often than not, and an HTML page drawn as an icon is a broken image.
    if (!type.startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.length || body.length > MAX_BYTES) return null;
    return { body, type };
  } finally {
    clearTimeout(timer);
  }
}
