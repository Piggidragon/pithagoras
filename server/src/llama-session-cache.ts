import { createHash } from 'node:crypto';

/** Serialize save/restore with inference because Cortex uses one model slot. */
export class LlamaSessionCache {
  private tails = new Map<string, Promise<void>>();
  private resident = new Map<string, string>();
  async run(origin: string, model: string, session: string, signal: AbortSignal, work: () => Promise<boolean>) {
    const lane = `${origin}/${model}`;
    const previous = this.tails.get(lane) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(lane, gate);
    const filename = createHash('sha256').update(`${model}\0${session}`).digest('hex') + '.bin';
    const action = async (name: string) => {
      const response = await fetch(new URL(`/slots/0?action=${name}`, origin), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, filename }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) { await response.body?.cancel(); return false; }
      const result = await response.json() as Record<string, number>;
      return (result[name === 'save' ? 'n_saved' : 'n_restored'] ?? 0) > 0;
    };
    try {
      await previous;
      signal.throwIfAborted();
      if (this.resident.get(lane) !== session) {
        // Missing or incompatible caches fall back to normal prompt evaluation.
        await action('restore').catch(() => false);
      }
      signal.throwIfAborted();
      const completed = await work();
      this.resident.delete(lane);
      if (completed && !signal.aborted && await action('save').catch(() => false)) this.resident.set(lane, session);
    } finally {
      release();
      if (this.tails.get(lane) === gate) this.tails.delete(lane);
    }
  }
}
