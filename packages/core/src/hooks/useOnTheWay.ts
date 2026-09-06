import { useEffect, useMemo, useState } from "react";
import { buildOnTheWay, type OnTheWayDay } from "../domain/on-the-way";
import { useCalendar } from "./useCalendar";

const HOUR_MS = 60 * 60 * 1000;
/** How often the coarse clock re-checks whether the wall hour has flipped. */
const CLOCK_CHECK_MS = 60_000;

/**
 * A clock re-stamped when the wall hour flips: the `buildOnTheWay` memo input
 * that makes an episode airing while the home screen sits open drop from
 * "Tonight" within the hour, instead of lingering until the day flips.
 */
function useHourClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (Math.floor(Date.now() / HOUR_MS) !== Math.floor(now / HOUR_MS)) setNow(Date.now());
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [now]);
  return now;
}

/**
 * "On the way": the next 72 hours of the calendar read, day-grouped and capped
 * at `maxRows`. Summary and detail over one cached query, so the section and
 * the Calendar tab can never disagree about what is coming.
 */
export function useOnTheWay(maxRows: number, enabled = true): readonly OnTheWayDay[] {
  const calendar = useCalendar(undefined, enabled);
  const clock = useHourClock();
  return useMemo(
    () => buildOnTheWay(calendar.days, clock, maxRows),
    [calendar.days, clock, maxRows],
  );
}
