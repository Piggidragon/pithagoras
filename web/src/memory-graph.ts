/**
 * Where the notes of the agent's memory go in its graph: a small force
 * layout, run to rest before anything is drawn.
 *
 * Notes push each other apart, a link pulls its two ends together, and
 * everything is drawn towards the middle so unlinked notes do not drift off.
 * Started on a circle rather than at random, so the same memory is laid out
 * the same way each time. Quadratic in the number of notes, which a memory
 * of a few hundred notes runs through in a moment.
 */
export interface Placed {
  path: string;
  x: number;
  y: number;
}

export function layout(paths: string[], edges: { source: string; target: string }[], rounds = 300): Placed[] {
  const n = paths.length;
  const at = new Map(paths.map((p, i) => [p, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const radius = 40 + 12 * n;
  for (let i = 0; i < n; i++) {
    x[i] = radius * Math.cos((2 * Math.PI * i) / Math.max(1, n));
    y[i] = radius * Math.sin((2 * Math.PI * i) / Math.max(1, n));
  }
  const links = edges
    .map((e) => [at.get(e.source), at.get(e.target)] as const)
    .filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);

  const REPEL = 6000;
  const LENGTH = 90;
  const SPRING = 0.06;
  const GRAVITY = 0.012;
  for (let round = 0; round < rounds; round++) {
    // Cooling: big moves first, then settling.
    const heat = 1 - round / rounds;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d2 = ex * ex + ey * ey;
        // Two in the same place are nudged apart, the same way each time.
        if (d2 < 0.01) {
          ex = ((i - j) % 7) + 0.5;
          ey = ((j * 3 - i) % 5) + 0.5;
          d2 = ex * ex + ey * ey;
        }
        const d = Math.sqrt(d2);
        const f = REPEL / d2;
        dx[i] += (ex / d) * f;
        dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f;
        dy[j] -= (ey / d) * f;
      }
    }
    for (const [a, b] of links) {
      const ex = x[b] - x[a];
      const ey = y[b] - y[a];
      const d = Math.sqrt(ex * ex + ey * ey) || 1;
      const f = (d - LENGTH) * SPRING;
      dx[a] += (ex / d) * f;
      dy[a] += (ey / d) * f;
      dx[b] -= (ex / d) * f;
      dy[b] -= (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * GRAVITY;
      dy[i] -= y[i] * GRAVITY;
      // No step longer than the heat allows: the layout settles instead of shaking.
      const step = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      const most = 30 * heat + 0.5;
      const scale = step > most ? most / step : 1;
      x[i] += dx[i] * scale;
      y[i] += dy[i] * scale;
    }
  }
  return paths.map((path, i) => ({ path, x: x[i], y: y[i] }));
}

/** The box around the placed notes, with room for their labels. */
export function bounds(placed: Placed[], pad = 60): { x: number; y: number; width: number; height: number } {
  if (!placed.length) return { x: -100, y: -100, width: 200, height: 200 };
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return { x: minX, y: minY, width: Math.max(...xs) + pad - minX, height: Math.max(...ys) + pad - minY };
}

const COLOURS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#60a5fa", "#4ade80", "#e879f9", "#2dd4bf"];

/** A colour per type of note, the same for the same type every time. */
export function colourOf(type: string | undefined): string {
  if (!type) return "#94a3b8";
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}
