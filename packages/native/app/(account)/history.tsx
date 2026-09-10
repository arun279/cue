import { groupHistory, historyRange, historyScopeKey } from "@cue/core/domain/history";
import { localTimeZone } from "@cue/core/domain/time";
import { useRemovePlay } from "@cue/core/hooks/useRemovePlay";
import { historyQuery } from "@cue/core/queries/history";
import { useRuntime } from "@cue/core/runtime/runtime";
import { parseHistorySearch } from "@cue/core/url/search-params";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { type ReactElement, useMemo } from "react";
import { SectionList, Text, View } from "react-native";
import { TEST_IDS } from "../../src/ui/test-ids";

/**
 * The diary, over the shared paged read. Its medium and month route state use
 * the core parser, where a
 * month without a valid year is not a position, so it is dropped with it.
 */
export default function History(): ReactElement {
  const runtime = useRuntime();
  const params = useLocalSearchParams<{ type?: string; year?: string; month?: string }>();
  const search = parseHistorySearch(params);
  const filter = search.type ?? "all";
  const range = useMemo(
    () => (search.year === undefined ? undefined : historyRange(search.year, search.month)),
    [search.year, search.month],
  );
  const query = useInfiniteQuery(
    historyQuery(runtime, filter, historyScopeKey(search.year, search.month), range),
  );
  const removal = useRemovePlay();
  const days = useMemo(() => {
    const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
    const visible =
      removal.removedIds.size === 0
        ? entries
        : entries.filter((entry) => !removal.removedIds.has(entry.historyId));
    return groupHistory(visible, { now: Date.now(), timeZone: localTimeZone() });
  }, [query.data, removal.removedIds]);

  return (
    <View testID={TEST_IDS.screenHistory}>
      <Text accessibilityRole="header">History</Text>
      <SectionList
        testID={TEST_IDS.historyList}
        sections={days.map((day) => ({
          title: day.label,
          data: day.groups.flatMap((group) => group.entries),
        }))}
        keyExtractor={(entry) => String(entry.historyId)}
        renderSectionHeader={({ section }) => (
          <Text testID={TEST_IDS.historyDay}>{section.title}</Text>
        )}
        renderItem={({ item }) => <Text testID={TEST_IDS.historyRow}>{item.title}</Text>}
        ListEmptyComponent={<Text testID={TEST_IDS.historyEmpty}>Nothing watched yet.</Text>}
        onEndReached={() => void query.fetchNextPage()}
      />
    </View>
  );
}
