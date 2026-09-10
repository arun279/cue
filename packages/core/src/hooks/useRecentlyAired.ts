import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type CalendarEntry, recentCalendarStart } from "../domain/calendar";
import { dayKeyOf } from "../domain/day";
import { DAY_MS, localTimeZone } from "../domain/time";
import { recentlyAiredQuery, selectVisibleEntries } from "../queries/calendar";
import { useRuntime } from "../runtime/runtime";
import { useCoarseClock } from "./useCoarseClock";

export function useRecentlyAired(enabled = true): readonly CalendarEntry[] | undefined {
  const runtime = useRuntime();
  const now = useCoarseClock(DAY_MS);
  const startDate = recentCalendarStart(dayKeyOf(localTimeZone(), now));
  const query = useQuery({ ...recentlyAiredQuery(runtime, startDate), enabled });
  return useMemo(
    () => (query.data === undefined ? undefined : selectVisibleEntries(query.data)),
    [query.data],
  );
}
