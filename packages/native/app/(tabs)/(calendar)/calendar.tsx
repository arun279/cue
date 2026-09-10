import { buildCalendarDays, CALENDAR_WINDOW_DAYS } from "@cue/core/domain/calendar";
import { dayKeyOf } from "@cue/core/domain/day";
import { epCode } from "@cue/core/domain/model/library";
import { DAY_MS, localTimeZone } from "@cue/core/domain/time";
import { useCoarseClock } from "@cue/core/hooks/useCoarseClock";
import { calendarQuery } from "@cue/core/queries/calendar";
import { queryStatus } from "@cue/core/queries/freshness";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useMemo } from "react";
import { SectionList, Text, View } from "react-native";
import { TEST_IDS } from "../../../src/ui/test-ids";

/** The calendar agenda, read-only, over the shared window hook. */
export default function Calendar(): ReactElement {
  const runtime = useRuntime();
  const now = useCoarseClock(DAY_MS);
  const timeZone = localTimeZone();
  const startDate = dayKeyOf(timeZone, now);
  const query = useQuery(calendarQuery(runtime, startDate));
  const days = useMemo(
    () =>
      query.data === undefined
        ? []
        : buildCalendarDays(query.data, now, timeZone, startDate, CALENDAR_WINDOW_DAYS),
    [query.data, now, timeZone, startDate],
  );
  const { isLoading } = queryStatus(query, query.data !== undefined);

  if (isLoading) return <Text testID={TEST_IDS.calendarSkeleton}>Loading the calendar…</Text>;

  return (
    <View testID={TEST_IDS.screenCalendar}>
      <Text accessibilityRole="header">Calendar</Text>
      <SectionList
        testID={TEST_IDS.calendarList}
        sections={days.map((day) => ({ title: day.label, data: [...day.rows] }))}
        keyExtractor={(row) => String(row.ids.trakt)}
        renderSectionHeader={({ section }) => (
          <Text testID={TEST_IDS.calendarDay}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Text testID={TEST_IDS.calendarRow(item.ids.trakt)}>
            {item.showTitle} {epCode(item.season, item.number)}
          </Text>
        )}
        ListEmptyComponent={<Text testID={TEST_IDS.calendarEmpty}>Nothing on the way.</Text>}
      />
    </View>
  );
}
