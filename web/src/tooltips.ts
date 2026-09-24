/**
 * Tooltips in the portal's own style, for every `title` in the app.
 *
 * The browser's tooltip is a system-grey box that arrives a second late and
 * ignores the theme. Rather than rewrite hundreds of `title`s, the attribute
 * is lifted off an element while the pointer is on it — so the native one
 * never shows — and put back when it leaves, so screen readers and React's
 * own bookkeeping see it as it was.
 */
const DELAY = 450;

export function installTooltips(): void {
  if (typeof document === "undefined" || !window.matchMedia("(hover: hover)").matches) return;
  const tip = document.createElement("div");
  tip.className = "ui-tooltip";
  tip.setAttribute("role", "presentation");
  document.body.appendChild(tip);

  let owner: HTMLElement | null = null;
  let text = "";
  let timer = 0;
  let watch = 0;

  const release = () => {
    window.clearTimeout(timer);
    window.clearInterval(watch);
    // Put back only if nothing set a new one meanwhile.
    if (owner && text && !owner.hasAttribute("title")) owner.setAttribute("title", text);
    owner = null;
    text = "";
    tip.classList.remove("is-shown");
  };

  const place = () => {
    if (!owner) return;
    // Gone from the page while the pointer was on it — a button that goes when
    // a run starts, a row that was deleted. No pointerout comes for it, and its
    // box is all zeros: the tip would appear in the corner and stay there.
    if (!owner.isConnected) return release();
    const r = owner.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const t = tip.getBoundingClientRect();
    const below = r.top < t.height + 12;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    const top = below ? r.bottom + 8 : r.top - t.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.dataset.side = below ? "below" : "above";
    tip.classList.add("is-shown");
    window.clearInterval(watch);
    watch = window.setInterval(() => {
      if (!owner) return;
      if (!owner.isConnected) return release();
      // React gave it a new title while it was lifted ("Copy" to "Copied"):
      // lifted again, and said instead, or the browser's own would show too.
      const next = owner.getAttribute("title")?.trim();
      if (next) {
        owner.removeAttribute("title");
        if (next !== text) {
          text = next;
          place();
        }
      }
    }, 250);
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      // Still within the one whose title is lifted: its title is not on it now,
      // so looking it up again would find nothing, or an ancestor's.
      if (owner?.contains(e.target as Node)) return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title]");
      release();
      if (!el) return;
      const t = el.getAttribute("title")?.trim();
      // Inside an iframe or the terminal the page is not ours to decorate.
      if (!t || el.closest(".xterm")) return;
      owner = el;
      text = t;
      el.removeAttribute("title");
      timer = window.setTimeout(place, DELAY);
    },
    true,
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      if (owner && !owner.contains(e.relatedTarget as Node | null)) release();
    },
    true,
  );
  for (const type of ["pointerdown", "keydown", "scroll", "blur"]) window.addEventListener(type, release, true);
}
