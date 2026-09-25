import {
  groupHistory,
  type HistoryEntry,
  historyRange,
  historyScopeKey,
} from "@cue/core/domain/history";
import { DAY_MS, localTimeZone } from "@cue/core/domain/time";
import { useCoarseClock } from "@cue/core/hooks/useCoarseClock";
import { useRemovePlay } from "@cue/core/hooks/useRemovePlay";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { type QueryStatus, queryStatus } from "@cue/core/queries/freshness";
import { historyQuery } from "@cue/core/queries/history";
import { useRuntime } from "@cue/core/runtime/runtime";
import { readFailureBody } from "@cue/core/sync-contract";
import { type HistorySearch, parseHistorySearch } from "@cue/core/url/search-params";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Separator } from "../../ui/Row";
import { SyncStrip } from "../../ui/SyncStrip";
import { TabRoot } from "../../ui/TabRoot";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { AgendaSkeleton } from "../calendar/Agenda";
import { HistoryChoice } from "./HistoryChoice";
import { HistoryRow } from "./HistoryRow";
import { MonthJump } from "./MonthJump";
import { historySections, itemKey, jumpLabel } from "./model";

export function HistoryScreen(): ReactElement {
  const runtime = useRuntime();
  const router = useRouter();
  const search = parseHistorySearch(useLocalSearchParams());
  const [title, setTitle] = useState("");
  const [jumping, setJumping] = useState(false);
  const clock = useCoarseClock(DAY_MS);
  const range = search.year === undefined ? undefined : historyRange(search.year, search.month);
  const query = useInfiniteQuery(
    historyQuery(runtime, search.type ?? "all", historyScopeKey(search.year, search.month), range),
  );
  const removal = useRemovePlay();
  const entries = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.entries) ?? []).filter(
        (entry) => !removal.removedIds.has(entry.historyId),
      ),
    [query.data, removal.removedIds],
  );
  const sections = useMemo(
    () => historySections(groupHistory(entries, { now: clock, timeZone: localTimeZone() }), title),
    [entries, clock, title],
  );
  const status = queryStatus(query, query.data !== undefined);
  const banner = useSyncBanner(status);
  const refresh = usePullToRefresh();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const next = () => {
    if (query.hasNextPage && !query.isFetching) void query.fetchNextPage();
  };
  const remove = (entry: HistoryEntry) =>
    void removal.removePlay(
      entry,
      entries.filter((other) => itemKey(other) === itemKey(entry)).length - 1,
    );

  return (
    <TabRoot testID={TEST_IDS.screenHistory}>
      <Stack.Screen
        options={{
          title: "History",
          headerLargeTitle: false,
          headerTintColor: colors.accentInk,
          headerTitleStyle: { color: colors.fg },
          headerRight: () => (
            <Button
              label="Sync now"
              variant="link"
              testID={TEST_IDS.syncNow}
              onPress={refresh.sync}
            />
          ),
          headerSearchBarOptions: {
            placement: "stacked",
            placeholder: "Filter by title",
            hideWhenScrolling: false,
            hideNavigationBar: false,
            obscureBackground: false,
            autoCapitalize: "none",
            onChangeText: (event) => setTitle(event.nativeEvent.text),
            onCancelButtonPress: () => setTitle(""),
          },
        }}
      />
      <SectionList
        testID={TEST_IDS.historyList}
        sections={sections}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.s4 }}
        keyExtractor={(row) => itemKey(row.entry)}
        onEndReached={() => {
          if (!query.isFetchNextPageError) next();
        }}
        refreshControl={
          <RefreshControl
            refreshing={refresh.refreshing}
            onRefresh={refresh.pull}
            tintColor={colors.muted}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.band, { backgroundColor: colors.bg }]}>
            {section.yearHeading === null ? null : (
              <CueText variant="sectionHeading" style={{ color: colors.fg }}>
                {section.yearHeading}
              </CueText>
            )}
            <CueText
              testID={TEST_IDS.historyDay(sections.indexOf(section))}
              variant="meta"
              weight="semibold"
              eyebrow
              accessibilityRole="header"
              style={{ color: colors.muted }}
            >
              {section.label}
            </CueText>
          </View>
        )}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            {index === 0 ? null : <Separator inset={62 + SPACE.s3 + SPACE.s6 + SPACE.s3} />}
            <HistoryRow {...item} onRemove={remove} />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.lead}>
            {banner && <SyncStrip banner={banner} onRetry={() => void query.refetch()} />}
            <View style={styles.choices}>
              {(
                [
                  ["", "All", TEST_IDS.historyFilterAll],
                  ["tv", "Shows", TEST_IDS.historyFilterShows],
                  ["movies", "Movies", TEST_IDS.historyFilterMovies],
                ] as const
              ).map(([type, label, testID]) => (
                <HistoryChoice
                  compact
                  key={label}
                  label={label}
                  selected={(search.type ?? "") === type}
                  testID={testID}
                  onPress={() => router.setParams({ type })}
                />
              ))}
              <HistoryChoice
                compact
                label={jumpLabel(search.year, search.month)}
                testID={TEST_IDS.historyJump}
                onPress={() => setJumping(true)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.lead}>
            <HistoryEmpty
              status={status}
              title={title}
              search={search}
              retry={() => void query.refetch()}
              recent={() => router.setParams({ year: "", month: "" })}
            />
          </View>
        }
        ListFooterComponent={
          <View style={styles.lead}>
            {query.isFetchNextPageError ? (
              <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
                Couldn't load earlier history.
              </CueText>
            ) : null}
            {query.hasNextPage ? (
              <Button
                label={
                  query.isFetchNextPageError
                    ? "Retry"
                    : query.isFetchingNextPage
                      ? "Loading earlier history"
                      : "Load earlier history"
                }
                variant="link"
                disabled={query.isFetching}
                testID={TEST_IDS.historyMore}
                onPress={next}
              />
            ) : null}
          </View>
        }
      />
      {jumping && (
        <MonthJump
          scope={search}
          onClose={() => setJumping(false)}
          onPick={(year, month) => {
            setJumping(false);
            router.setParams({
              year: year === undefined ? "" : String(year),
              month: month === undefined ? "" : String(month),
            });
          }}
        />
      )}
    </TabRoot>
  );
}

function HistoryEmpty({
  status,
  title,
  search,
  retry,
  recent,
}: {
  readonly status: QueryStatus;
  readonly title: string;
  readonly search: HistorySearch;
  retry(): void;
  recent(): void;
}): ReactElement {
  if (status.isLoading) return <AgendaSkeleton />;
  if (status.isError && !status.hasData)
    return (
      <EmptyState
        centered
        headline="Couldn't load your history"
        body={readFailureBody(status.failure)}
      >
        <Button label="Retry" onPress={retry} />
      </EmptyState>
    );
  if (title.trim() !== "")
    return (
      <EmptyState
        headline="No titles match."
        body={`Nothing loaded matches "${title.trim()}". Scroll loads more history to search.`}
      />
    );
  if (search.year !== undefined)
    return (
      <EmptyState
        headline={`Nothing watched in ${jumpLabel(search.year, search.month)}.`}
        body="No plays fall in this window. Pick another month, or head back to recent history."
      >
        <Button label="Back to recent" onPress={recent} />
      </EmptyState>
    );
  return (
    <EmptyState
      testID={TEST_IDS.historyEmpty}
      headline="Nothing logged yet."
      body="Everything you mark lands here and can be removed here."
    />
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: SPACE.s4, gap: SPACE.s2 },
  row: { paddingHorizontal: SPACE.s4 },
  band: {
    paddingHorizontal: SPACE.s4,
    paddingTop: SPACE.s4,
    paddingBottom: SPACE.s2,
    gap: SPACE.s3,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.s2, paddingVertical: SPACE.s2 },
});
