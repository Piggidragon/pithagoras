const DONE_KEY = "pithagoras.setup";

/** Whether this browser has been through the setup assistant, or waved it away. */
export function setupDismissed(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

export function dismissSetup(how: "done" | "skipped") {
  try {
    localStorage.setItem(DONE_KEY, how);
  } catch {
    // Asked again next time, which is no harm.
  }
}
