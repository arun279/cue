import { useEffect, useState } from "react";
import { dayKeyOf } from "../domain/day";
import { DAY_MS, localTimeZone } from "../domain/time";

const CLOCK_CHECK_MS = 60_000;

function bucketOf(ms: number, granularityMs: number, timeZone: string): string {
  return granularityMs >= DAY_MS ? dayKeyOf(timeZone, ms) : String(Math.floor(ms / granularityMs));
}

export function useCoarseClock(granularityMs: number, timeZone: string = localTimeZone()): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      if (bucketOf(current, granularityMs, timeZone) !== bucketOf(now, granularityMs, timeZone)) {
        setNow(current);
      }
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [granularityMs, now, timeZone]);
  return now;
}
