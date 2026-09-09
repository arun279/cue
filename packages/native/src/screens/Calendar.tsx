import { epCode } from "@cue/core/domain/model/library";
import { useCalendar } from "@cue/core/hooks/useCalendar";
import type { ReactElement } from "react";
import { SectionList, Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/** The calendar agenda, read-only, over the shared window hook. */
export function Calendar(): ReactElement {
  const { days, isLoading } = useCalendar();

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
