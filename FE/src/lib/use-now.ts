import { useEffect, useState } from "react";

/** Current instant, ticking every second. Null until mounted to avoid SSR hydration mismatch. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
