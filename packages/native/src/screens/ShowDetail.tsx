import type { SeasonView } from "@cue/core/data/trakt/show-detail";
import { defaultSeason, seasonConfirmation } from "@cue/core/domain/show-detail";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { queryStatus } from "@cue/core/queries/freshness";
import { usePlayPolicy } from "@cue/core/stores/play-policy-store";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { confirm } from "../ui/confirm";
import { EmptyState } from "../ui/EmptyState";
import { ScreenTitle } from "../ui/ScreenTitle";
import { Skeleton } from "../ui/Skeleton";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, tabBarClearance, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { ContinueBar } from "./show-detail/ContinueBar";
import { DetailError, DetailSkeleton } from "./show-detail/DetailStates";
import { RelatedShows } from "./show-detail/RelatedShows";
import { SeasonList } from "./show-detail/SeasonList";
import { ShowAbout, ShowHero } from "./show-detail/ShowHero";
import { ShowMenu } from "./show-detail/ShowMenu";
import { useDetailMark } from "./show-detail/useDetailMark";
import { useShowDetail } from "./show-detail/useShowDetail";

export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const enabled = usePrefs((state) => state.showsEnabled);
  return (
    <View testID={TEST_IDS.screenShowDetail} style={styles.screen}>
      {enabled ? <ShowContent showId={showId} /> : <ShowDisabled />}
    </View>
  );
}

function ShowDisabled(): ReactElement {
  const router = useRouter();
  return (
    <EmptyState
      headline="TV shows are turned off."
      body="Turn TV shows back on in Settings to see this show."
    >
      <Button label="Open Settings" onPress={() => router.push("/settings")} />
    </EmptyState>
  );
}

function ShowContent({ showId }: { readonly showId: number }): ReactElement {
  const { header, seasons, entry } = useShowDetail(showId);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const seasonList = seasons.data ?? [];
  const mark = useDetailMark(showId, seasonList);
  const nextMark = useMarkWatched();
  if (header.isError && header.data === undefined)
    return <DetailError subject="this show" failure={header.failure} onRetry={header.refetch} />;
  if (header.data === undefined || entry === undefined)
    return <DetailSkeleton testID={TEST_IDS.showDetailSkeleton} />;
  const data = header.data;
  const confirmSeason = (season: SeasonView): void => {
    const copy = seasonConfirmation(season, usePlayPolicy.getState().policy);
    confirm({
      ...copy,
      onPrimary: () =>
        void (copy.kind === "unmark"
          ? mark.controller.unmarkSeason(mark.target, season)
          : mark.controller.markSeason(mark.target, season)),
      onSecondary: () => void mark.controller.rewatchSeason(mark.target, season),
    });
  };
  return (
    <>
      <ScreenTitle title={data.title} />
      <ShowMenu header={data} entry={entry} seasons={seasonList} mark={mark} />
      <ScrollView
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
      >
        <ShowHero header={data} />
        <View style={[styles.continue, { backgroundColor: colors.bg }]}>
          <ContinueBar entry={entry} mark={nextMark} />
        </View>
        <View style={styles.seasons}>
          <SeasonsStatus
            loading={queryStatus(seasons, seasons.data !== undefined).isLoading}
            failed={seasons.isError}
            empty={seasons.data?.length === 0}
            retry={() => void seasons.refetch()}
          />
          <SeasonList
            showId={showId}
            seasons={seasonList}
            initial={defaultSeason(seasonList, data.nextEpisode)}
            onConfirm={confirmSeason}
            onMark={mark.toggle}
            onOpen={(episode) =>
              router.push(`/show/${showId}/episode/${episode.season}/${episode.number}`)
            }
          />
        </View>
        <RelatedShows showId={showId} />
        <ShowAbout header={data} seasons={seasonList} />
      </ScrollView>
    </>
  );
}

function SeasonsStatus({
  loading,
  failed,
  empty,
  retry,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly empty: boolean;
  readonly retry: () => void;
}): ReactElement | null {
  if (failed)
    return (
      <View>
        <CueText variant="rowTitleSecondary">Couldn't load episodes</CueText>
        <Button label="Retry" onPress={retry} variant="link" />
      </View>
    );
  if (loading)
    return (
      <View style={{ gap: SPACE.s3 }}>
        {[1, 2, 3].map((key) => (
          <Skeleton key={key} width="100%" height={48} />
        ))}
      </View>
    );
  return empty ? (
    <EmptyState
      headline="No episodes announced yet"
      body="Seasons land here as soon as this show has episodes."
    />
  ) : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  continue: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
  seasons: { padding: SPACE.s4, gap: SPACE.s2 },
});
