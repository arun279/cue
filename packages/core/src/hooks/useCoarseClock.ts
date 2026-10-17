import { useEffect, useState } from "react";

const CLOCK_CHECK_MS = 60_000;

export function useCoarseClock(granularityMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (Math.floor(Date.now() / granularityMs) !== Math.floor(now / granularityMs)) {
        setNow(Date.now());
      }
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [granularityMs, now]);
  return now;
}
