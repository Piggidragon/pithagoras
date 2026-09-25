import { readFileSync } from "node:fs";

/** Fields of /proc/<pid>/stat after the command name, which may hold spaces: [0] is the state, [3] the session. */
export const fieldsOf = (stat: string): string[] => stat.slice(stat.lastIndexOf(")") + 2).split(" ");

export function statOf(pid: string | number): string[] | undefined {
  try {
    return fieldsOf(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return undefined;
  }
}
