import { useEffect, useState } from "react";

/**
 * The time, redrawn once a second while `on`: for an elapsed time that counts.
 * It is read again the moment `on` turns true, so a clock that was not running
 * does not show the second it stopped at.
 */
export function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}
