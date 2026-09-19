import type { EpisodeView, SeasonView } from "@cue/core/data/trakt/show-detail";
import { detailDate } from "@cue/core/domain/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import { watchedPercent } from "@cue/core/format";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { LinearTransition, ReduceMotion } from "react-native-reanimated";
import { CheckControl } from "../../ui/CheckControl";
import { Chevron } from "../../ui/Chevron";
import { ProgressBar } from "../../ui/ProgressBar";
import { Row, Separator } from "../../ui/Row";
import { TEST_IDS } from "../../ui/test-ids";
import { RAIL, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export interface SeasonRowProps {
  readonly showId: number;
  readonly season: SeasonView;
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly onConfirm: () => void;
  readonly onOpen: (episode: EpisodeView) => void;
  readonly onMark: (episode: EpisodeView) => void;
}

export function SeasonRow({
  showId,
  season,
  expanded,
  onExpand,
  onConfirm,
  onOpen,
  onMark,
}: SeasonRowProps): ReactElement {
  const colors = useColors();
  const title = season.isSpecial ? "Specials" : `Season ${season.number}`;
  const complete = season.airedCount > 0 && season.completedCount >= season.airedCount;
  return (
    <Animated.View
      testID={TEST_IDS.seasonRow(season.number)}
      layout={LinearTransition.duration(180).reduceMotion(ReduceMotion.System)}
    >
      <Row
        label={`${title}, ${season.completedCount} of ${season.airedCount} watched, ${expanded ? "expanded" : "collapsed"}`}
        minHeight={56}
        testID={TEST_IDS.seasonTrigger(season.number)}
        onPress={onExpand}
        trailing={
          <CheckControl
            testID={TEST_IDS.seasonCheck(season.number)}
            checked={complete}
            label={`${complete ? "Unmark" : "Mark"} ${title} watched`}
            disabled={season.airedCount === 0}
            onPress={onConfirm}
          />
        }
      >
        <View style={styles.heading}>
          <CueText variant="rowTitle" style={[styles.title, { color: colors.fg }]}>
            {title}
          </CueText>
          <CueText variant="micro" tabularNums style={{ color: colors.muted }}>
            {season.completedCount}/{season.airedCount}
          </CueText>
          <ProgressBar
            width={RAIL.row}
            percent={watchedPercent(season.completedCount, season.airedCount)}
          />
          <Chevron direction={expanded ? "up" : "down"} />
        </View>
      </Row>
      <Separator />
      {expanded &&
        season.episodes.map((episode) => (
          <EpisodeRow
            key={episode.ids.trakt}
            showId={showId}
            episode={episode}
            onOpen={() => onOpen(episode)}
            onMark={() => onMark(episode)}
          />
        ))}
    </Animated.View>
  );
}

function EpisodeRow({
  showId,
  episode,
  onOpen,
  onMark,
}: {
  readonly showId: number;
  readonly episode: EpisodeView;
  readonly onOpen: () => void;
  readonly onMark: () => void;
}): ReactElement {
  const colors = useColors();
  const code = epCode(episode.season, episode.number);
  return (
    <View>
      <Row
        testID={TEST_IDS.episodeRow(episode.ids.trakt)}
        label={`${code}, ${episode.title ?? ""}`}
        minHeight={48}
        onPress={onOpen}
        leading={
          <CueText variant="micro" style={{ color: colors.muted }}>
            {episode.number}
          </CueText>
        }
        trailing={
          episode.aired ? (
            <CheckControl
              checked={episode.watched}
              label={episode.watched ? "Watched. Tap to remove." : `Mark ${code} watched`}
              testID={
                episode.watched
                  ? TEST_IDS.episodeChecked(showId, episode.season, episode.number)
                  : TEST_IDS.episodeCheck(showId, episode.season, episode.number)
              }
              onPress={onMark}
            />
          ) : null
        }
      >
        <CueText variant="rowTitleSecondary" style={{ color: colors.fg }}>
          {episode.title ?? code}
        </CueText>
        {episode.firstAired !== null && (
          <CueText variant="meta" style={{ color: colors.muted }}>
            {episode.aired ? "" : "Airs "}
            {detailDate(episode.firstAired)}
          </CueText>
        )}
      </Row>
      <Separator />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s2 },
  title: { flexGrow: 1 },
});
