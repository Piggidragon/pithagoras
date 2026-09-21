import { useState } from "react";
import { toggleOpen } from "./tool-groups";

const KEY = "toolGroupsOpen";

/**
 * Which groups of tools are open, remembered between visits.
 *
 * They start shut. A machine with a few extensions on it has sixty tools in
 * seven groups, and a list of sixty checkboxes is not a list anybody reads —
 * what somebody came here for is one extension, and the summary on each closed
 * group says whether the others need looking at.
 *
 * Remembered because the group you open is the one you keep coming back to,
 * and shared between the settings page and the popover beside the composer:
 * they are the same groups, asked about at two different scopes.
 */
export function useOpenGroups() {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  });

  const toggle = (source: string) =>
    setOpen((prev) => {
      const next = toggleOpen(prev, source);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // A browser that will not store it still opens and shuts them.
      }
      return next;
    });

  return { isOpen: (source: string) => open.includes(source), toggle };
}
