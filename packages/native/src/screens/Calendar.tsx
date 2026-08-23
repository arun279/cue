import { epCode } from "@cue/core/domain/model/library";
import { useCalendar } from "@cue/core/hooks/useCalendar";
import type { ReactElement } from "react";
import { SectionList, Text, View } from "react-native";

/** The calendar agenda, read-only, over the shared window hook. */
export function Calendar(): ReactElement {
  const { days, isLoading } = useCalendar();

  if (isLoading) return <Text testID="calendar-skeleton">Loading the calendar…</Text>;

  return (
    <View testID="screen-calendar">
      <Text accessibilityRole="header">Calendar</Text>
      <SectionList
        testID="calendar-list"
        sections={days.map((day) => ({ title: day.label, data: [...day.rows] }))}
        keyExtractor={(row) => String(row.ids.trakt)}
        renderSectionHeader={({ section }) => <Text testID="calendar-day">{section.title}</Text>}
        renderItem={({ item }) => (
          <Text testID="calendar-row">
            {item.showTitle} {epCode(item.season, item.number)}
          </Text>
        )}
        ListEmptyComponent={<Text testID="calendar-empty">Nothing on the way.</Text>}
      />
    </View>
  );
}
