import type { SeasonView } from "@cue/core/data/trakt/show-detail";
import { defaultSeason, orderSeasons, seasonConfirmation } from "@cue/core/domain/show-detail";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { Stack, useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { ConfirmationSheet } from "../ui/ConfirmationSheet";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, tabBarClearance, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { useConfirmation } from "../ui/useConfirmation";
import { ContinueBar } from "./show-detail/ContinueBar";
import { DetailError, DetailSkeleton, ShowDisabled } from "./show-detail/DetailStates";
import { RelatedShows } from "./show-detail/RelatedShows";
import { SeasonRow } from "./show-detail/SeasonRow";
import { ShowAbout, ShowHero } from "./show-detail/ShowHero";
import { ShowMenu } from "./show-detail/ShowMenu";
import { useDetailMark } from "./show-detail/useDetailMark";
import { useShowDetail } from "./show-detail/useShowDetail";

export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const enabled = usePrefs((state) => state.showsEnabled);
  const colors = useColors();
  return (
    <View
      testID={TEST_IDS.screenShowDetail}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <Stack.Screen
        options={{
          headerLargeTitle: false,
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accentInk,
          headerTitleStyle: { color: colors.fg },
        }}
      />
      {enabled ? <ShowContent showId={showId} /> : <ShowDisabled />}
    </View>
  );
}

function ShowContent({ showId }: { readonly showId: number }): ReactElement {
  const { header, seasons, entry } = useShowDetail(showId);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const mark = useDetailMark(showId, seasons.data ?? []);
  const nextMark = useMarkWatched();
  const confirmation = useConfirmation();
  const [expanded, setExpanded] = useState<ReadonlySet<number> | null>(null);
  if (header.isError && header.data === undefined)
    return <DetailError subject="this show" onRetry={header.refetch} />;
  if (header.data === undefined || entry === undefined)
    return <DetailSkeleton testID={TEST_IDS.showDetailSkeleton} />;
  const data = header.data;
  const initial = defaultSeason(seasons.data ?? [], data.nextEpisode);
  const open = expanded ?? new Set(initial === null ? [] : [initial]);
  const confirmSeason = (season: SeasonView): void => {
    const copy = seasonConfirmation(season);
    confirmation.present({
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
      <Stack.Screen
        options={{
          title: data.title,
          headerRight: () => (
            <ShowMenu
              header={data}
              entry={entry}
              seasons={seasons.data ?? []}
              mark={mark}
              confirm={confirmation.present}
            />
          ),
        }}
      />
      <ScrollView
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
      >
        <ShowHero header={data} />
        <View style={[styles.continue, { backgroundColor: colors.bg }]}>
          <ContinueBar entry={entry} mark={nextMark} />
        </View>
        <View testID={TEST_IDS.seasonList} style={styles.seasons}>
          <CueText
            variant="caption"
            testID={TEST_IDS.showProgress}
            style={{ color: colors.muted }}
          >{`${data.completed} of ${data.aired} watched`}</CueText>
          <SeasonsStatus
            loading={seasons.isLoading}
            failed={seasons.isError}
            empty={seasons.data?.length === 0}
            retry={() => void seasons.refetch()}
          />
          {orderSeasons(seasons.data ?? []).map((season) => (
            <SeasonRow
              key={season.number}
              showId={showId}
              season={season}
              expanded={open.has(season.number)}
              onExpand={() =>
                setExpanded((previous) => {
                  const next = new Set(previous ?? open);
                  if (next.has(season.number)) next.delete(season.number);
                  else next.add(season.number);
                  return next;
                })
              }
              onConfirm={() => confirmSeason(season)}
              onMark={mark.toggle}
              onOpen={(episode) =>
                router.push(`/show/${showId}/episode/${episode.season}/${episode.number}`)
              }
            />
          ))}
        </View>
        <RelatedShows showId={showId} />
        <ShowAbout header={data} />
      </ScrollView>
      <ConfirmationSheet confirmation={confirmation.pending} onDismiss={confirmation.dismiss} />
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
