import http from "node:http";
import { existsSync } from "node:fs";

/**
 * Just enough of the Docker API to run one container.
 *
 * Over the socket rather than the CLI: the portal image has no docker binary,
 * and shelling out would mean shipping one. No client library either — this is
 * five endpoints, and a dependency for five endpoints is a dependency to
 * upgrade forever.
 */

const SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

/**
 * Is the socket there?
 *
 * This used require() inside an ES module, which throws — and the throw was
 * caught and read as "no Docker here", so a deployment with a working socket
 * silently took the fallback path and reported no browser was possible.
 */
export const dockerAvailable = (): boolean => existsSync(SOCKET);

/** `timeoutMs`: given up once so long has passed in all, answer or not — not only after a silence. */
export function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCKET,
        path,
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        // Bytes, put together once they are all there: a letter split across
        // two chunks is two halves of one, not two broken ones.
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            // Some endpoints answer with newline-delimited JSON or nothing.
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      }
    );
    const deadline = timeoutMs
      ? setTimeout(() => req.destroy(Object.assign(new Error("Docker did not answer in time"), { code: "ETIMEDOUT" })), timeoutMs)
      : undefined;
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * A pull, reported as it goes.
 *
 * The image is measured in gigabytes, so a request that simply blocks until it
 * finishes looks identical to one that has hung. onProgress is called with
 * whatever the daemon last said.
 */
export function pullImage(image: string, onProgress: (line: string) => void): Promise<void> {
  const [name, tag = "latest"] = image.split(":");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET,
        path: `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
        method: "POST",
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          return reject(new Error(`Pull failed with ${res.statusCode}`));
        }
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const m = JSON.parse(line) as { status?: string; progress?: string; error?: string };
              if (m.error) return reject(new Error(m.error));
              if (m.status) onProgress(`${m.status}${m.progress ? " " + m.progress : ""}`);
            } catch {
              // A partial line; the next chunk completes it.
            }
          }
        });
        res.on("end", () => resolve());
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function imagePresent(image: string): Promise<boolean> {
  const { status } = await request("GET", `/images/${encodeURIComponent(image)}/json`);
  return status === 200;
}

export async function containerState(
  name: string
): Promise<{ exists: boolean; running: boolean; id?: string }> {
  const { status, body } = await request<{ State?: { Running?: boolean }; Id?: string }>(
    "GET",
    `/containers/${name}/json`
  );
  if (status !== 200) return { exists: false, running: false };
  return { exists: true, running: Boolean(body?.State?.Running), id: body?.Id };
}
