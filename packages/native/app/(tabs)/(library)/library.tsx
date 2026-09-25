import type { LibrarySort, MovieSort } from "@cue/core/domain/library-buckets";
import { useLibrarySnapshot } from "@cue/core/hooks/useLibrarySnapshot";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { queryStatus } from "@cue/core/queries/freshness";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { type ReactElement, useMemo, useRef, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { ChipRail } from "../../../src/screens/library/ChipRail";
import { LibraryState } from "../../../src/screens/library/LibraryStates";
import { MovieTile, ShowTile } from "../../../src/screens/library/LibraryTile";
import { LibraryToolbar } from "../../../src/screens/library/LibraryToolbar";
import {
  type ChipKey,
  FILTER_DEBOUNCE_MS,
  keyOf,
  type LibraryItem,
  matching,
  movieChips,
  movieSorts,
  type Segment,
  SHOW_SORTS,
  showChips,
  useDebounced,
} from "../../../src/screens/library/model";
import { BarItems } from "../../../src/ui/BarItems";
import { SyncStrip } from "../../../src/ui/SyncStrip";
import { TEST_IDS } from "../../../src/ui/test-ids";
import { SPACE, tabBarClearance, useColors } from "../../../src/ui/tokens";

const COLUMNS = 3;

/**
 * Everything already tracked, by medium and by status.
 *
 * The segmented control picks the medium, the chip rail picks the slice, and the
 * grid is the answer. Each segment remembers its own chip and its own order, so
 * moving between shows and movies returns to where the reader left rather than
 * resetting to a default they did not choose. Sort options are medium honest: a
 * film has no progress to sort by.
 */
export default function Library(): ReactElement {
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const moviesEnabled = usePrefs((state) => state.moviesEnabled);
  const [segment, setSegment] = useState<Segment>(showsEnabled ? "shows" : "movies");
  const [chips, setChips] = useState<Record<Segment, ChipKey>>({
    shows: "watching",
    movies: "watchlist",
  });
  const [showSort, setShowSort] = useState<LibrarySort>("recently-watched");
  const [movieSort, setMovieSort] = useState<MovieSort>("recently-watched");
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState("");
  const query = useDebounced(filter, FILTER_DEBOUNCE_MS);

  const runtime = useRuntime();
  const snapshot = useLibrarySnapshot(showsEnabled);
  const movies = useQuery({
    ...movieLibraryQuery(runtime),
    enabled: moviesEnabled && segment === "movies",
  });
  const shows = segment === "shows";
  const chip = chips[segment];

  const showView = useMemo(
    () => showChips(snapshot.data?.entries ?? [], Date.now(), snapshot.thresholdMs, showSort),
    [snapshot.data, snapshot.thresholdMs, showSort],
  );
  const movieView = useMemo(
    () => movieChips(movies.data?.entries ?? [], movieSort),
    [movies.data, movieSort],
  );
  const view = shows ? showView : movieView;
  const items = useMemo(() => matching(view.items[chip] ?? [], query), [view, chip, query]);

  const status = shows
    ? queryStatus(snapshot.query, snapshot.data !== undefined)
    : queryStatus(movies, movies.data !== undefined);
  const banner = useSyncBanner(status);
  const refresh = usePullToRefresh();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - 2 * SPACE.s4 - (COLUMNS - 1) * SPACE.s3) / COLUMNS);

  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(() => new Set());
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) =>
    setOnScreen(new Set(viewableItems.map((token) => String(token.key)))),
  );

  const clearFilter = (): void => {
    setFilter("");
    setFiltering(false);
  };
  const retry = (): void => void (shows ? snapshot.query.refetch() : movies.refetch());
  const toolbar = {
    bothMedia: showsEnabled && moviesEnabled,
    segment,
    onSegment: setSegment,
    filter,
    filtering,
    onFilter: setFilter,
    onFilterToggle: () => (filtering ? clearFilter() : setFiltering(true)),
  };

  // Unflattened, so UIKit finds the list first under the screen and collapses
  // the large title as it scrolls.
  return (
    <View
      collapsable={false}
      testID={TEST_IDS.screenLibrary}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <Stack.Screen
        options={{
          title: "Library",
          headerLargeTitle: true,
          headerRight: () => <BarItems onSync={refresh.sync} />,
        }}
      />
      <FlatList
        testID={TEST_IDS.libraryGrid}
        contentInsetAdjustmentBehavior="automatic"
        // The filter leaves a keyboard over the grid, and by default the first
        // tap under one only dismisses it: Clear filter would need two.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
        data={items}
        extraData={onScreen}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        keyExtractor={keyOf}
        onViewableItemsChanged={onViewableItemsChanged.current}
        refreshControl={
          <RefreshControl
            testID={TEST_IDS.refreshIndicator}
            refreshing={refresh.refreshing}
            onRefresh={refresh.pull}
            tintColor={colors.muted}
          />
        }
        renderItem={({ item }) => (
          <Tile item={item} chip={chip} width={tileWidth} onScreen={onScreen.has(keyOf(item))} />
        )}
        ListHeaderComponent={
          <View style={styles.lead}>
            {banner === null ? null : <SyncStrip banner={banner} onRetry={retry} />}
            {shows ? (
              <LibraryToolbar<LibrarySort>
                {...toolbar}
                sorts={SHOW_SORTS}
                sort={showSort}
                onSort={setShowSort}
              />
            ) : (
              <LibraryToolbar<MovieSort>
                {...toolbar}
                sorts={movieSorts(chip === "watched" ? "watched" : "watchlist")}
                sort={movieSort}
                onSort={setMovieSort}
              />
            )}
            <ChipRail
              chips={view.chips}
              selected={chip}
              onSelect={(key) => setChips({ ...chips, [segment]: key })}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <LibraryState
              status={status}
              segment={segment}
              chip={chip}
              query={query.trim()}
              width={tileWidth}
              onRetry={retry}
              onClear={clearFilter}
            />
          </View>
        }
      />
    </View>
  );
}

function Tile({
  item,
  chip,
  width,
  onScreen,
}: {
  readonly item: LibraryItem;
  readonly chip: ChipKey;
  readonly width: number;
  readonly onScreen: boolean;
}): ReactElement {
  return item.kind === "show" ? (
    <ShowTile entry={item.entry} chip={chip} width={width} onScreen={onScreen} />
  ) : (
    <MovieTile entry={item.entry} chip={chip} width={width} />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  lead: { paddingBottom: SPACE.s3, gap: SPACE.s2 },
  row: { gap: SPACE.s3, paddingHorizontal: SPACE.s4, paddingBottom: SPACE.s3 },
  empty: { paddingHorizontal: SPACE.s4 },
});
