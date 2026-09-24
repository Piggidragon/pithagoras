// The service worker is what makes the portal installable. Not under Vite's
// dev server, whose modules change on every save; and browsers only allow one
// over HTTPS or on localhost.
if ("serviceWorker" in navigator && window.isSecureContext && !document.querySelector('script[src="/@vite/client"]')) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
