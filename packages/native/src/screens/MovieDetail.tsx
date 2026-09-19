import type { MovieHeader } from "@cue/core/data/trakt/movie-library";
import { episodeStatus } from "@cue/core/domain/episode-detail";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { movieHeaderQuery, movieRelatedQuery } from "@cue/core/queries/movies";
import { useRuntime } from "@cue/core/runtime/runtime";
import { showSnack } from "@cue/core/stores/snackbar-store";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { CheckControl } from "../ui/CheckControl";
import { EmptyState } from "../ui/EmptyState";
import { RowMenu } from "../ui/RowMenu";
import { TEST_IDS } from "../ui/test-ids";
import { CHECK_SIZE, SPACE, tabBarClearance, useColors, useStacked } from "../ui/tokens";
import { CueText } from "../ui/type";
import { detailMarkStyles } from "./episode-sheet/EpisodeMarkRow";
import { useMovieActions } from "./movie-detail/useMovieActions";
import { DetailError, DetailSkeleton } from "./show-detail/DetailStates";
import { Overview } from "./show-detail/Overview";
import { RelatedTitles } from "./show-detail/RelatedShows";
import { DetailHero } from "./show-detail/ShowHero";

export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const enabled = usePrefs((state) => state.moviesEnabled);
  const colors = useColors();
  const router = useRouter();
  return (
    <View testID={TEST_IDS.screenMovieDetail} style={{ flex: 1, backgroundColor: colors.bg }}>
      {enabled ? (
        <MovieContent key={movieId} movieId={movieId} />
      ) : (
        <EmptyState
          headline="Movies are turned off"
          body="Turn Movies back on in Settings to browse and track films."
        >
          <Button label="Open Settings" onPress={() => router.push("/settings")} />
        </EmptyState>
      )}
    </View>
  );
}

function MovieContent({ movieId }: { readonly movieId: number }): ReactElement {
  const runtime = useRuntime();
  const header = useQuery(movieHeaderQuery(runtime, movieId));
  const library = useQuery(movieLibraryQuery(runtime));
  if (
    (header.isError && header.data === undefined) ||
    (library.isError && library.data === undefined)
  )
    return (
      <DetailError
        subject="this movie"
        onRetry={() => {
          void header.refetch();
          void library.refetch();
        }}
      />
    );
  if (header.data === undefined || library.data === undefined)
    return <DetailSkeleton testID={TEST_IDS.movieDetailSkeleton} />;
  return <LoadedMovie header={header.data} />;
}

function LoadedMovie({ header }: { readonly header: MovieHeader }): ReactElement {
  const runtime = useRuntime();
  const related = useQuery(movieRelatedQuery(runtime, header.movieId));
  const actions = useMovieActions(header);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const stacked = useStacked();
  return (
    <>
      <Stack.Screen
        options={{
          title: header.title,
          headerRight: () => (
            <RowMenu
              title={header.title}
              testID={TEST_IDS.movieMenu}
              items={[
                {
                  id: "watchlist",
                  label: actions.entry.inWatchlist ? "Remove from Watchlist" : "Add to Watchlist",
                  onPress: actions.toggleWatchlist,
                },
                {
                  id: "trakt",
                  label: "Open on Trakt",
                  image:
                    Platform.OS === "ios"
                      ? "arrow.up.right.square"
                      : require("../ui/open-in-new.xml"),
                  onPress: () => {
                    void WebBrowser.openBrowserAsync(
                      `https://trakt.tv/movies/${header.ids.slug ?? header.ids.trakt}`,
                    ).catch(() => showSnack({ message: "Couldn't open Trakt. Please try again." }));
                  },
                },
              ]}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
      >
        <DetailHero
          header={header}
          facts={[
            header.year,
            header.runtime === null ? null : `${header.runtime} min`,
            ...header.genres,
          ]}
        />
        <View style={styles.body}>
          <View
            style={[
              detailMarkStyles.row,
              stacked && detailMarkStyles.stacked,
              { backgroundColor: colors.elevated },
            ]}
          >
            <View style={detailMarkStyles.copy}>
              <CueText variant="rowTitle" style={{ color: colors.fg }}>
                {episodeStatus(actions.entry.watched, actions.entry.watchedAt, 1)}
              </CueText>
              {actions.entry.watched && (
                <CueText variant="meta" style={{ color: colors.ink2 }}>
                  tap the check to remove
                </CueText>
              )}
            </View>
            <CheckControl
              testID={TEST_IDS.movieMark}
              size={CHECK_SIZE.marquee}
              checked={actions.entry.watched}
              disabled={actions.busy}
              label={
                actions.entry.watched ? "Watched. Tap to remove." : `Mark ${header.title} watched`
              }
              onPress={actions.toggleWatched}
            />
          </View>
          <Overview text={header.overview} />
        </View>
        <RelatedTitles titles={related.data ?? []} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACE.s4, gap: SPACE.s2 },
});
