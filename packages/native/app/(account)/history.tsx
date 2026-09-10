import { useHistory } from "@cue/core/hooks/useHistory";
import { parseHistorySearch } from "@cue/core/url/search-params";
import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { SectionList, Text, View } from "react-native";
import { TEST_IDS } from "../../src/ui/test-ids";

/**
 * The diary, over the shared paged read. Its medium and month route state use
 * the core parser, where a
 * month without a valid year is not a position, so it is dropped with it.
 */
export default function History(): ReactElement {
  const params = useLocalSearchParams<{ type?: string; year?: string; month?: string }>();
  const search = parseHistorySearch(params);
  const history = useHistory({
    filter: search.type ?? "all",
    ...(search.year === undefined ? {} : { year: search.year }),
    ...(search.month === undefined ? {} : { month: search.month }),
  });

  return (
    <View testID={TEST_IDS.screenHistory}>
      <Text accessibilityRole="header">History</Text>
      <SectionList
        testID={TEST_IDS.historyList}
        sections={history.days.map((day) => ({
          title: day.label,
          data: day.groups.flatMap((group) => group.entries),
        }))}
        keyExtractor={(entry) => String(entry.historyId)}
        renderSectionHeader={({ section }) => (
          <Text testID={TEST_IDS.historyDay}>{section.title}</Text>
        )}
        renderItem={({ item }) => <Text testID={TEST_IDS.historyRow}>{item.title}</Text>}
        ListEmptyComponent={<Text testID={TEST_IDS.historyEmpty}>Nothing watched yet.</Text>}
        onEndReached={() => history.loadEarlier()}
      />
    </View>
  );
}
