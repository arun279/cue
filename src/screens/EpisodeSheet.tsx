import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { airsLine, type EpisodeDetail, sheetMetaLine } from "@/core/domain/episode-detail";
import { epCode } from "@/core/domain/model/library";
import { episodeNavigation } from "@/core/domain/show-detail";
import { usePrefs } from "@/core/prefs/prefs-store";
import { queryStatus } from "@/core/queries/freshness";
import { episodePlaysQuery, episodeQuery, showSeasonsQuery } from "@/core/queries/shows";
import { useRuntime } from "@/core/runtime/runtime";
import { SheetClose } from "../ui/SheetClose";
import { TEST_IDS } from "../ui/test-ids";
import { RADIUS, SPACE, sheetBottomInset, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { EpisodeMarkRow } from "./episode-sheet/EpisodeMarkRow";
import { EpisodeMenu } from "./episode-sheet/EpisodeMenu";
import { EpisodePager } from "./episode-sheet/EpisodePager";
import { EpisodeStill } from "./episode-sheet/EpisodeStill";
import { DetailError, DetailSkeleton } from "./show-detail/DetailStates";
import { Overview } from "./show-detail/Overview";
import { useDetailMark } from "./show-detail/useDetailMark";

export interface EpisodeSheetProps {
  readonly showId: number;
  readonly season: number;
  readonly episode: number;
}

export function EpisodeSheet(props: EpisodeSheetProps): ReactElement {
  return (
    <View testID={TEST_IDS.episodeSheet} style={styles.screen}>
      <EpisodeContent key={`${props.showId}:${epCode(props.season, props.episode)}`} {...props} />
    </View>
  );
}

function EpisodeContent({ showId, season, episode }: EpisodeSheetProps): ReactElement {
  const runtime = useRuntime();
  const query = useQuery(episodeQuery(runtime, showId, season, episode));
  if (query.data !== undefined) return <LoadedEpisode detail={query.data} />;
  return (
    <>
      <View style={[styles.toolbar, styles.pending]}>
        <SheetClose />
      </View>
      {query.isError ? (
        <DetailError
          subject="this episode"
          failure={queryStatus(query, false).failure}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DetailSkeleton testID={TEST_IDS.episodeSkeleton} />
      )}
    </>
  );
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
  const hidden = usePrefs((state) => state.hideStillsUntilWatched);
  const navigation = seasons.data === undefined ? detail : episodeNavigation(seasons.data, detail);
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={TEST_IDS.screenEpisode}
      style={[styles.content, { paddingBottom: SPACE.s4 + sheetBottomInset(insets.bottom) }]}
    >
      <View style={styles.toolbar}>
        {detail.aired && <EpisodeMenu detail={detail} plays={plays} mark={mark} />}
        <SheetClose />
      </View>
      <EpisodeBody
        detail={detail}
        guarded={hidden && !detail.watched}
        plays={plays}
        onMark={() => mark.toggle(detail, plays)}
      />
      <EpisodePager showId={detail.showId} prev={navigation.prev} next={navigation.next} />
    </View>
  );
}

export function EpisodeBody({
  detail,
  guarded,
  plays,
  onMark,
}: {
  readonly detail: EpisodeDetail;
  readonly guarded: boolean;
  readonly plays: number;
  readonly onMark: () => void;
}): ReactElement {
  const colors = useColors();
  return (
    <View style={styles.body}>
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
      {detail.aired && <EpisodeMarkRow detail={detail} plays={plays} onMark={onMark} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, padding: SPACE.s4 },
  body: { flex: 1, gap: SPACE.s3, paddingBottom: SPACE.s3 },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: SPACE.s2,
  },
  pending: { paddingHorizontal: SPACE.s4, paddingTop: SPACE.s4 },
  countdown: {
    minHeight: 214,
    borderRadius: RADIUS.poster,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACE.s2,
    padding: SPACE.s4,
  },
});
