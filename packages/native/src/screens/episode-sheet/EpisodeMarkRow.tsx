import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import { episodeStatus } from "@cue/core/domain/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { CheckControl } from "../../ui/CheckControl";
import { TEST_IDS } from "../../ui/test-ids";
import { CHECK_SIZE, RADIUS, SPACE, useColors, useStacked } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function EpisodeMarkRow({
  detail,
  plays,
  onMark,
  renderCheck,
}: {
  readonly detail: EpisodeDetail;
  readonly plays: number;
  readonly onMark: () => void;
  readonly renderCheck?: (check: ReactElement) => ReactElement;
}): ReactElement {
  const colors = useColors();
  const stacked = useStacked();
  const check = (
    <CheckControl
      checked={detail.watched}
      size={CHECK_SIZE.marquee}
      label={
        detail.watched
          ? "Watched. Tap to remove."
          : `Mark ${epCode(detail.season, detail.number)} watched`
      }
      onPress={onMark}
    />
  );
  return (
    <View
      testID={TEST_IDS.episodeMarkRow}
      style={[styles.row, stacked && styles.stacked, { backgroundColor: colors.elevated }]}
    >
      <View style={styles.copy}>
        <CueText testID={TEST_IDS.episodeWatched} variant="rowTitle" style={{ color: colors.fg }}>
          {episodeStatus(detail.watched, detail.watchedAt, plays)}
        </CueText>
        {detail.watched && plays < 2 && (
          <CueText variant="meta" style={{ color: colors.ink2 }}>
            tap the check to remove
          </CueText>
        )}
        {plays > 1 && (
          <CueText
            variant="micro"
            style={[styles.badge, { color: colors.ink2, backgroundColor: colors.surface }]}
          >
            {plays} plays
          </CueText>
        )}
      </View>
      {renderCheck ? renderCheck(check) : check}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    borderRadius: RADIUS.control,
    padding: SPACE.s3,
  },
  stacked: { flexDirection: "column", alignItems: "flex-start" },
  copy: { flex: 1, gap: SPACE.s1 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: SPACE.s2,
    paddingVertical: SPACE.s1,
    borderRadius: RADIUS.pill,
  },
});
