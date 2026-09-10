import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import { airsLine, sheetMetaLine } from "@cue/core/domain/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import { episodeNavigation } from "@cue/core/domain/show-detail";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { episodePlaysQuery, episodeQuery, showSeasonsQuery } from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { TEST_IDS } from "../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { useConfirmation } from "../ui/useConfirmation";
import { EpisodeMarkRow } from "./episode-sheet/EpisodeMarkRow";
import { EpisodeMenu } from "./episode-sheet/EpisodeMenu";
import { EpisodePager } from "./episode-sheet/EpisodePager";
import { EpisodeStill } from "./episode-sheet/EpisodeStill";
import { DetailError, DetailSkeleton, ShowDisabled } from "./show-detail/DetailStates";
import { Overview } from "./show-detail/Overview";
import { useDetailMark } from "./show-detail/useDetailMark";

export interface EpisodeSheetProps {
  readonly showId: number;
  readonly season: number;
  readonly episode: number;
}

export function EpisodeSheet(props: EpisodeSheetProps): ReactElement {
  const enabled = usePrefs((state) => state.showsEnabled);
  const router = useRouter();
  const code = epCode(props.season, props.episode);
  return (
    <View testID={TEST_IDS.episodeSheet} style={styles.screen}>
      <Stack.Screen
        options={{
          title: code,
          headerRight: () => (
            <Button
              testID={TEST_IDS.episodeSheetClose}
              label="Close"
              variant="link"
              onPress={() => router.back()}
            />
          ),
        }}
      />
      {enabled ? <EpisodeContent key={`${props.showId}:${code}`} {...props} /> : <ShowDisabled />}
    </View>
  );
}

function EpisodeContent({ showId, season, episode }: EpisodeSheetProps): ReactElement {
  const runtime = useRuntime();
  const query = useQuery(episodeQuery(runtime, showId, season, episode));
  if (query.isError && query.data === undefined)
    return <DetailError subject="this episode" onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return <DetailSkeleton testID={TEST_IDS.episodeSkeleton} />;
  return <LoadedEpisode detail={query.data} />;
}

function LoadedEpisode({ detail }: { readonly detail: EpisodeDetail }): ReactElement {
  const runtime = useRuntime();
  const seasons = useQuery(showSeasonsQuery(runtime, detail.showId));
  const playsQuery = useQuery({
    ...episodePlaysQuery(runtime, detail.showId, detail.season, detail.number, detail.ids.trakt),
    enabled: detail.watched,
  });
  const plays = detail.watched ? Math.max(1, playsQuery.data?.length ?? 1) : 0;
  const mark = useDetailMark(detail.showId, seasons.data ?? []);
  const confirmation = useConfirmation();
  const hidden = usePrefs((state) => state.hideStillsUntilWatched);
  const navigation = seasons.data === undefined ? detail : episodeNavigation(seasons.data, detail);
  return (
    <ScrollView testID={TEST_IDS.screenEpisode} contentContainerStyle={styles.content}>
      {detail.aired && (
        <View style={styles.toolbar}>
          <EpisodeMenu detail={detail} plays={plays} mark={mark} confirm={confirmation.present} />
        </View>
      )}
      <EpisodeBody
        detail={detail}
        guarded={hidden && !detail.watched}
        plays={plays}
        onMark={() => mark.toggle(detail, plays)}
        renderCheck={
          detail.watched
            ? (check) => (
                <EpisodeMenu
                  detail={detail}
                  plays={plays}
                  mark={mark}
                  confirm={confirmation.present}
                >
                  {check}
                </EpisodeMenu>
              )
            : undefined
        }
      />
      <EpisodePager showId={detail.showId} prev={navigation.prev} next={navigation.next} />
    </ScrollView>
  );
}

export function EpisodeBody({
  detail,
  guarded,
  plays,
  onMark,
  renderCheck,
}: {
  readonly detail: EpisodeDetail;
  readonly guarded: boolean;
  readonly plays: number;
  readonly onMark: () => void;
  readonly renderCheck?: (check: ReactElement) => ReactElement;
}): ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.body, { paddingBottom: insets.bottom + SPACE.s2 }]}>
      {detail.aired ? (
        <EpisodeStill
          key={detail.ids.trakt}
          episodeId={detail.ids.trakt}
          stills={detail.stills}
          guarded={guarded}
        />
      ) : (
        <View style={[styles.countdown, { backgroundColor: colors.elevated }]}>
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            {detail.title}
          </CueText>
          <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
            {detail.firstAired === null ? "Air date to be announced" : airsLine(detail.firstAired)}
          </CueText>
        </View>
      )}
      <CueText testID={TEST_IDS.episodeCode} variant="meta" style={{ color: colors.ink2 }}>
        {sheetMetaLine(detail)}
      </CueText>
      <CueText variant="identity" accessibilityRole="header" style={{ color: colors.fg }}>
        {detail.title ?? epCode(detail.season, detail.number)}
      </CueText>
      <Overview text={detail.overview} />
      {detail.aired && (
        <EpisodeMarkRow detail={detail} plays={plays} onMark={onMark} renderCheck={renderCheck} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACE.s4, paddingBottom: SPACE.s7 },
  body: { gap: SPACE.s3 },
  toolbar: { alignItems: "flex-end" },
  countdown: {
    minHeight: 214,
    borderRadius: RADIUS.poster,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACE.s2,
    padding: SPACE.s4,
  },
});
