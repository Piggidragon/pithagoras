import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "@earendil-works/pi-coding-agent";

/**
 * pi's main entry, as this server resolves it.
 *
 * import.meta.resolve, not require.resolve: the package's exports map declares
 * only an "import" condition, so CJS resolution fails outright. Resolved when
 * asked, so the server still starts if pi cannot be found.
 */
export const piEntry = (): string => import.meta.resolve(NAME);

/** A file in pi, relative to its main entry. */
export const piFile = (relative: string): URL => new URL(relative, piEntry());

/**
 * pi's command line: the file its package.json names as `pi`, when it is there.
 *
 * Read from the package rather than guessed next to the entry, so a release
 * that moves one and not the other is noticed.
 */
export function piCli(): string | undefined {
  try {
    let dir = path.dirname(fileURLToPath(piEntry()));
    for (;;) {
      const manifest = path.join(dir, "package.json");
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        if (pkg.name === NAME) {
          const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
          const cli = bin ? path.join(dir, bin) : undefined;
          return cli && existsSync(cli) ? cli : undefined;
        }
      }
      if (path.dirname(dir) === dir) return undefined;
      dir = path.dirname(dir);
    }
  } catch {
    return undefined;
  }
}
