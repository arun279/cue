import type { SearchHit } from "@cue/core/data/trakt/search";
import { visibleSearchHits } from "@cue/core/domain/discover";
import { middleTruncate } from "@cue/core/format";
import { useIsOffline } from "@cue/core/hooks/useIsOffline";
import { useSearchInput } from "@cue/core/hooks/useSearchInput";
import { useWatchlistAdd } from "@cue/core/hooks/useWatchlistAdd";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { browseQuery, searchQuery } from "@cue/core/queries/discover";
import { type QueryStatus, queryStatus } from "@cue/core/queries/freshness";
import { useRuntime } from "@cue/core/runtime/runtime";
import { showFailure, showUndoable } from "@cue/core/stores/snackbar-store";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { type ReactElement, useEffect, useMemo, useRef } from "react";
import { FlatList, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { Browse } from "../../../src/screens/search/Browse";
import { browseGrids, placeholderFor } from "../../../src/screens/search/model";
import { ResultRow } from "../../../src/screens/search/ResultRow";
import { type SearchPhase, SearchState } from "../../../src/screens/search/SearchStates";
import { Separator } from "../../../src/ui/Row";
import { TEST_IDS } from "../../../src/ui/test-ids";
import { ROW_TEXT_INSET, SPACE, tabBarClearance, useColors } from "../../../src/ui/tokens";

const COLUMNS = 3;

/**
 * Find something not yet tracked, and add it.
 *
 * The field is the platform's own, a `UISearchController` on iOS and the
 * Material search bar on Android, and it is deliberately never auto-focused so
 * the keyboard never opens uninvited. Idle is not a prompt: it is what this
 * reader looked for in this session over a sample of each enabled medium, which
 * is the structure Apple's standard search tab style asks for. There is no pull
 * to refresh, because Search has no cached staleness to resolve, and therefore
 * no "Sync now" item either.
 */
export default function Search(): ReactElement {
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const moviesEnabled = usePrefs((state) => state.moviesEnabled);
  const field = useRef<SearchBarCommands>(null);
  const { input, setInput, query, settling, recent } = useSearchInput();

  const runtime = useRuntime();
  const results = useQuery({ ...searchQuery(runtime, query), enabled: query.length > 0 });
  const browse = useQuery(browseQuery(runtime));
  const watchlist = useWatchlistAdd();
  const offline = useIsOffline();

  const hits = results.data ?? [];
  const visible = useMemo(
    () => visibleSearchHits(hits, showsEnabled, moviesEnabled),
    [hits, showsEnabled, moviesEnabled],
  );
  const grids = useMemo(
    () => browseGrids(browse.data, showsEnabled, moviesEnabled),
    [browse.data, showsEnabled, moviesEnabled],
  );

  const status = queryStatus(results, results.data !== undefined);
  const querying = input.trim().length > 0;
  const phase = phaseOf(offline, settling, status);

  const { addError, clearAddError } = watchlist;
  useEffect(() => {
    if (addError !== null) showFailure(addError, clearAddError);
  }, [addError, clearAddError]);

  const add = (hit: SearchHit): void => {
    void watchlist.add(hit);
    showUndoable({ subject: middleTruncate(hit.title), predicate: " added to Watchlist" }, () =>
      watchlist.remove(hit),
    );
  };
  const recall = (term: string): void => {
    field.current?.setText(term);
    setInput(term);
  };

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <View testID={TEST_IDS.screenSearch} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          title: "Search",
          headerLargeTitle: true,
          headerSearchBarOptions: {
            ref: field,
            placeholder: placeholderFor(showsEnabled, moviesEnabled),
            placement: "stacked",
            hideWhenScrolling: false,
            autoCapitalize: "none",
            onChangeText: (event) => setInput(event.nativeEvent.text),
            // iOS draws its own field fill and placeholder and only wants the
            // caret and Cancel tinted; Material's search bar is a Cue surface
            // and takes the whole palette.
            ...(Platform.OS === "android"
              ? {
                  barTintColor: colors.elevated,
                  textColor: colors.fg,
                  hintTextColor: colors.muted,
                  headerIconColor: colors.muted,
                }
              : { tintColor: colors.accentInk }),
          },
        }}
      />
      <FlatList
        testID={TEST_IDS.searchResults}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
        data={querying && phase === null ? visible : []}
        keyExtractor={(hit) => hit.key}
        ItemSeparatorComponent={() => <Separator inset={ROW_TEXT_INSET} />}
        renderItem={({ item }) => (
          <ResultRow hit={item} added={watchlist.isAdded(item)} onAdd={add} />
        )}
        ListEmptyComponent={
          <View style={styles.body}>
            {querying ? (
              <SearchState
                phase={phase ?? "empty"}
                query={query}
                hidden={phase === null ? hits.length : 0}
                moviesEnabled={moviesEnabled}
                failure={status.failure}
                onRetry={() => void results.refetch()}
              />
            ) : (
              <Browse
                status={queryStatus(browse, browse.data !== undefined)}
                grids={grids}
                recent={recent}
                width={Math.floor((width - 2 * SPACE.s4 - (COLUMNS - 1) * SPACE.s3) / COLUMNS)}
                onRecall={recall}
                onRetry={() => void browse.refetch()}
              />
            )}
          </View>
        }
      />
    </View>
  );
}

/**
 * Which non-result screen a typed query is on, or `null` when the read has
 * settled and the results themselves are the answer. Offline comes first
 * because Search is the one surface that genuinely needs a network: every other
 * screen paints from the persisted cache before it asks for anything.
 */
function phaseOf(offline: boolean, settling: boolean, status: QueryStatus): SearchPhase | null {
  if (offline) return "offline";
  if (status.isError) return "error";
  if (settling || !status.hasData) return "searching";
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: SPACE.s4 },
});
