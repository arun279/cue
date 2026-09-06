import { useHistory } from "@cue/core/hooks/useHistory";
import { parseHistorySearch } from "@cue/core/url/search-params";
import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { SectionList, Text, View } from "react-native";

/**
 * The diary, over the shared paged read. The medium and the month it is
 * scrolled to are the web app's own URL state, parsed by the same function: a
 * month without a valid year is not a position, so it is dropped with it.
 */
export function History(): ReactElement {
  const params = useLocalSearchParams<{ type?: string; year?: string; month?: string }>();
  const search = parseHistorySearch(params);
  const history = useHistory({
    filter: search.type ?? "all",
    ...(search.year === undefined ? {} : { year: search.year }),
    ...(search.month === undefined ? {} : { month: search.month }),
  });

  return (
    <View testID="screen-history">
      <Text accessibilityRole="header">History</Text>
      <SectionList
        testID="history-list"
        sections={history.days.map((day) => ({
          title: day.label,
          data: day.groups.flatMap((group) => group.entries),
        }))}
        keyExtractor={(entry) => String(entry.historyId)}
        renderSectionHeader={({ section }) => <Text testID="history-day">{section.title}</Text>}
        renderItem={({ item }) => <Text testID="history-row">{item.title}</Text>}
        ListEmptyComponent={<Text testID="history-empty">Nothing watched yet.</Text>}
        onEndReached={() => history.loadEarlier()}
      />
    </View>
  );
}
