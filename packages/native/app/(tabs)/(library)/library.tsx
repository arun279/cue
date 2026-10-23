import type { LibrarySort } from "@cue/core/domain/library-buckets";
import { useLibrarySnapshot } from "@cue/core/hooks/useLibrarySnapshot";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { queryStatus } from "@cue/core/queries/freshness";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { type NativeStackNavigationOptions, Stack } from "expo-router";
import { type ReactElement, useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  type ListRenderItem,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { ChipRail } from "../../../src/screens/library/ChipRail";
import { LibraryState } from "../../../src/screens/library/LibraryStates";
import { MovieTile, ShowTile, usePosterGrid } from "../../../src/screens/library/LibraryTile";
import {
  type ChipKey,
  FILTER_DEBOUNCE_MS,
  keyOf,
  type LibraryItem,
  matching,
  movieChips,
  SEGMENTS,
  type Segment,
  showChips,
  sortsFor,
  useDebounced,
} from "../../../src/screens/library/model";
import { BarItems } from "../../../src/ui/BarItems";
import { usePerfScroll } from "../../../src/ui/harness";
import type { ToolbarMenuProps } from "../../../src/ui/RowMenu";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { SyncStrip } from "../../../src/ui/SyncStrip";
import { TabRoot } from "../../../src/ui/TabRoot";
import { TEST_IDS } from "../../../src/ui/test-ids";
import { SPACE, tabBarClearance, useColors } from "../../../src/ui/tokens";

const POSTER_RATIO = 3 / 2;
// Viewport heights kept rendered: the visible one and two on each side.
const WINDOW_SCREENS = 5;

export default function Library(): ReactElement {
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const moviesEnabled = usePrefs((state) => state.moviesEnabled);
  const [segment, setSegment] = useState<Segment>(showsEnabled ? "shows" : "movies");
  const [chips, setChips] = useState<Record<Segment, ChipKey>>({
    shows: "watching",
    movies: "not-started",
  });
  const [sorts, setSorts] = useState<Partial<Record<`${Segment}:${ChipKey}`, LibrarySort>>>({});
  const [filter, setFilter] = useState("");
  const field = useRef<SearchBarCommands>(null);
  const grid = useRef<FlatList<LibraryItem>>(null);
  usePerfScroll("library", (offset) => grid.current?.scrollToOffset({ offset, animated: true }));
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "Library",
      headerLargeTitle: true,
      headerSearchBarOptions: {
        ref: field,
        placement: "stacked",
        placeholder: "Filter by title",
        hideWhenScrolling: false,
        hideNavigationBar: false,
        obscureBackground: false,
        autoCapitalize: "none",
        onChangeText: (event) => setFilter(event.nativeEvent.text),
        onSearchButtonPress: () => field.current?.blur(),
        onCancelButtonPress: () => setFilter(""),
        onClose: () => setFilter(""),
      },
    }),
    [],
  );
  const query = useDebounced(filter, FILTER_DEBOUNCE_MS);

  const runtime = useRuntime();
  const snapshot = useLibrarySnapshot(showsEnabled);
  const movies = useQuery({
    ...movieLibraryQuery(runtime),
    enabled: moviesEnabled && segment === "movies",
  });
  const shows = segment === "shows";
  const chip = chips[segment];
  const sortOptions = sortsFor(segment, chip);
  const sort = sorts[`${segment}:${chip}`] ?? sortOptions[0].id;

  const showView = useMemo(
    () => showChips(snapshot.data?.entries ?? [], Date.now(), snapshot.thresholdMs),
    [snapshot.data, snapshot.thresholdMs],
  );
  const movieView = useMemo(() => movieChips(movies.data?.entries ?? []), [movies.data]);
  const view = shows ? showView : movieView;
  const items = useMemo(() => matching(view.items(chip, sort), query), [view, chip, sort, query]);

  const status = shows
    ? queryStatus(snapshot.query, snapshot.data !== undefined)
    : queryStatus(movies, movies.data !== undefined);
  const banner = useSyncBanner(status);
  const refresh = usePullToRefresh();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { columns, width: tileWidth } = usePosterGrid();
  const rowsPerScreen = Math.ceil(useWindowDimensions().height / (tileWidth * POSTER_RATIO));
  const renderItem = useCallback<ListRenderItem<LibraryItem>>(
    ({ item }) => {
      const tile = <Tile item={item} chip={chip} width={tileWidth} />;
      return columns > 1 ? tile : <View style={styles.row}>{tile}</View>;
    },
    [chip, tileWidth, columns],
  );

  const clearFilter = (): void => {
    field.current?.cancelSearch();
    setFilter("");
  };
  const retry = (): void => void (shows ? snapshot.query.refetch() : movies.refetch());
  const selectChip = (key: ChipKey): void => setChips({ ...chips, [segment]: key });
  const sortMenu: ToolbarMenuProps = {
    title: "Sort",
    label: "Sort",
    icon: "sort",
    testID: TEST_IDS.librarySort,
    items: sortOptions.map((option) => ({
      id: option.testID,
      label: option.label,
      selected: option.id === sort,
      onPress: () => setSorts({ ...sorts, [`${segment}:${chip}`]: option.id }),
    })),
  };

  return (
    <TabRoot testID={TEST_IDS.screenLibrary}>
      <Stack.Screen options={screenOptions} />
      <BarItems menu={sortMenu} />
      <FlatList
        ref={grid}
        testID={TEST_IDS.libraryGrid}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
        data={items}
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.row : undefined}
        keyExtractor={keyOf}
        initialNumToRender={rowsPerScreen}
        maxToRenderPerBatch={rowsPerScreen}
        windowSize={WINDOW_SCREENS}
        refreshControl={
          <RefreshControl
            testID={TEST_IDS.refreshIndicator}
            refreshing={refresh.refreshing}
            onRefresh={refresh.pull}
            tintColor={colors.muted}
          />
        }
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.lead}>
            {banner === null ? null : <SyncStrip banner={banner} onRetry={retry} />}
            {showsEnabled && moviesEnabled ? (
              <SegmentedControl<Segment>
                segments={SEGMENTS}
                value={segment}
                onChange={setSegment}
                style={styles.segments}
              />
            ) : null}
            <ChipRail chips={view.chips} selected={chip} onSelect={selectChip} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <LibraryState
              status={status}
              segment={segment}
              view={view}
              chip={chip}
              onChip={selectChip}
              query={query.trim()}
              width={tileWidth}
              onRetry={retry}
              onClear={clearFilter}
            />
          </View>
        }
      />
    </TabRoot>
  );
}

function Tile({
  item,
  chip,
  width,
}: {
  readonly item: LibraryItem;
  readonly chip: ChipKey;
  readonly width: number;
}): ReactElement {
  return item.kind === "show" ? (
    <ShowTile entry={item.entry} chip={chip} width={width} />
  ) : (
    <MovieTile entry={item.entry} chip={chip} width={width} />
  );
}

const styles = StyleSheet.create({
  lead: { paddingBottom: SPACE.s3, gap: SPACE.s2 },
  segments: { marginHorizontal: SPACE.s4, marginBottom: SPACE.s2 },
  row: { gap: SPACE.s3, paddingHorizontal: SPACE.s4, paddingBottom: SPACE.s3 },
  empty: { paddingHorizontal: SPACE.s4 },
});
