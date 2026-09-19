import {
  airingGrammar,
  buildCalendarDays,
  CALENDAR_WINDOW_DAYS,
  type CalendarRow,
} from "@cue/core/domain/calendar";
import { dayKeyOf, dayOffset } from "@cue/core/domain/day";
import { DAY_MS, localTimeZone } from "@cue/core/domain/time";
import { useCoarseClock } from "@cue/core/hooks/useCoarseClock";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { calendarQuery } from "@cue/core/queries/calendar";
import { queryStatus } from "@cue/core/queries/freshness";
import { useRuntime } from "@cue/core/runtime/runtime";
import { readFailureBody } from "@cue/core/sync-contract";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { type ReactElement, useMemo } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { AGENDA_TEXT_INSET, AgendaSkeleton, DayHeader } from "../../../src/screens/calendar/Agenda";
import { AiringRow } from "../../../src/ui/AiringRow";
import { BarItems } from "../../../src/ui/BarItems";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { Separator } from "../../../src/ui/Row";
import { SyncStrip } from "../../../src/ui/SyncStrip";
import { TvShowsOff } from "../../../src/ui/TvShowsOff";
import { TEST_IDS } from "../../../src/ui/test-ids";
import { ROW_MIN_HEIGHT, SPACE, tabBarClearance, useColors } from "../../../src/ui/tokens";

interface DaySection {
  readonly label: string;
  /** Whole local days from today, which is what the countdown chip counts. */
  readonly offset: number;
  readonly data: readonly CalendarRow[];
}

type Branch = "tv-off" | "loading" | "error" | "empty" | "agenda";

/**
 * The Calendar: what is airing, and when, for the next four weeks.
 *
 * One read, day-grouped in the viewer's own timezone, under pinned day bands.
 * Nothing here is markable and there is no reminder bell: an aired unwatched
 * episode is already in the queue, so a second place to act would be a second
 * answer to the same question. Tapping a row opens the show, which with pull to
 * refresh is the entire interaction set.
 *
 * The clock is day-coarse, so the groups, their labels and the countdowns
 * re-anchor when the local day turns over under a screen left open overnight.
 */
export default function Calendar(): ReactElement {
  const runtime = useRuntime();
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const clock = useCoarseClock(DAY_MS);
  const timeZone = localTimeZone();
  const startDate = dayKeyOf(timeZone, clock);
  const query = useQuery({ ...calendarQuery(runtime, startDate), enabled: showsEnabled });
  const sections = useMemo(
    () =>
      query.data === undefined
        ? []
        : buildCalendarDays(query.data, clock, timeZone, startDate, CALENDAR_WINDOW_DAYS).map(
            (day) => ({
              label: day.label,
              offset: dayOffset(startDate, day.dayKey),
              data: day.rows,
            }),
          ),
    [query.data, clock, timeZone, startDate],
  );
  const status = queryStatus(query, query.data !== undefined);
  const banner = useSyncBanner(status);
  const refresh = usePullToRefresh();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const branch = branchOf(
    showsEnabled,
    status.isLoading,
    status.isError && !status.hasData,
    sections.length,
  );

  return (
    <View testID={TEST_IDS.screenCalendar} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          title: "Calendar",
          headerLargeTitle: true,
          headerRight: () => <BarItems onSync={refresh.sync} />,
        }}
      />
      <SectionList<CalendarRow, DaySection>
        testID={TEST_IDS.calendarList}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
        stickySectionHeadersEnabled
        sections={branch === "agenda" ? sections : []}
        keyExtractor={(row) => String(row.ids.trakt)}
        refreshControl={
          <RefreshControl
            testID={TEST_IDS.refreshIndicator}
            refreshing={refresh.refreshing}
            onRefresh={refresh.pull}
            tintColor={colors.muted}
          />
        }
        renderSectionHeader={({ section }) => (
          <DayHeader
            label={section.label}
            count={section.data.length}
            today={section.offset === 0}
          />
        )}
        renderItem={({ item, index, section }) => (
          <View style={styles.row}>
            {/* Inside a day group only: a hairline across a day boundary would
                argue with the band that separates the groups. */}
            {index === 0 ? null : <Separator inset={AGENDA_TEXT_INSET - SPACE.s4} />}
            <AiringRow
              row={item}
              {...airingGrammar(item, section.offset)}
              minHeight={ROW_MIN_HEIGHT.calendar}
              testID={TEST_IDS.calendarRow(item.ids.trakt)}
            />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.lead}>
            {banner === null ? null : (
              <SyncStrip banner={banner} onRetry={() => void query.refetch()} />
            )}
            <Lead branch={branch} failure={status.failure} onRetry={() => void query.refetch()} />
          </View>
        }
      />
    </View>
  );
}

function branchOf(showsEnabled: boolean, loading: boolean, failed: boolean, days: number): Branch {
  if (!showsEnabled) return "tv-off";
  if (loading) return "loading";
  if (failed) return "error";
  return days === 0 ? "empty" : "agenda";
}

/** What stands above the agenda. Exactly one of these renders. */
function Lead({
  branch,
  failure,
  onRetry,
}: {
  readonly branch: Branch;
  readonly failure: Parameters<typeof readFailureBody>[0];
  onRetry(): void;
}): ReactElement | null {
  if (branch === "tv-off") {
    return (
      <TvShowsOff
        body="Turn TV shows back on in Settings to see what's coming."
        testID={TEST_IDS.calendarTvOff}
      />
    );
  }
  if (branch === "loading") return <AgendaSkeleton />;
  if (branch === "error") {
    return (
      <EmptyState
        testID={TEST_IDS.calendarError}
        centered
        headline="Couldn't load your calendar"
        body={readFailureBody(failure)}
      >
        <Button label="Retry" onPress={onRetry} testID={TEST_IDS.calendarErrorRetry} />
      </EmptyState>
    );
  }
  if (branch === "empty") {
    return (
      <EmptyState
        testID={TEST_IDS.calendarEmpty}
        headline="No upcoming episodes in the next 28 days."
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  lead: { paddingHorizontal: SPACE.s4, paddingBottom: SPACE.s2 },
  row: { paddingHorizontal: SPACE.s4 },
});
