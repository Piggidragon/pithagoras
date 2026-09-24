/*
 * The portal as an installed app: the shell opens without a round trip, and
 * opens at all when the server is out of reach — then says so, as it does in a
 * tab. Nothing the agent does is cached: /api and the browser view always go
 * to the server, and a page is always asked for fresh first, so a deploy is
 * there on the next load rather than the one after.
 */
const CACHE = "pithagoras-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/theme-init.js", "/icon-192.png", "/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Every deploy names its assets anew, and the old names are never asked for
 * again. The oldest go once there are more than a few deploys' worth.
 */
const MAX_ASSETS = 120;
async function prune(cache) {
  const assets = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith("/assets/"));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((request) => cache.delete(request)));
}

/** Live, or served by the server alone: never from here. */
const passThrough = (url) =>
  url.pathname.startsWith("/api/") || url.pathname.startsWith("/browser-ui") || url.pathname.startsWith("/voice-assets/");

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || passThrough(url)) return;

  // A page: the server's, and the last one it gave when it cannot be reached.
  // Every route is the same index.html, so one copy serves them all.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  // Built assets are named by their content: a cached one is never stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy).then(() => prune(cache)));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Icons and the like: the cached copy now, a fresh one for next time.
  if (SHELL.includes(url.pathname) || url.pathname.endsWith(".png")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || fresh;
      }),
    );
  }
});
