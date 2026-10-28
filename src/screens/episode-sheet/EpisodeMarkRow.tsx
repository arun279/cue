import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { EpisodeDetail } from "@/core/domain/episode-detail";
import { episodeStatus } from "@/core/domain/episode-detail";
import { epCode } from "@/core/domain/model/library";
import { CheckControl } from "../../ui/CheckControl";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors, useStacked } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function EpisodeMarkRow({
  detail,
  plays,
  onMark,
}: {
  readonly detail: EpisodeDetail;
  readonly plays: number;
  readonly onMark: () => void;
}): ReactElement {
  const colors = useColors();
  const stacked = useStacked();
  return (
    <View
      testID={TEST_IDS.episodeMarkRow}
      style={[
        detailMarkStyles.row,
        stacked && detailMarkStyles.stacked,
        { backgroundColor: colors.elevated },
      ]}
    >
      <View style={detailMarkStyles.copy}>
        <CueText variant="rowTitle" style={{ color: colors.fg }}>
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
            style={[
              detailMarkStyles.badge,
              { color: colors.ink2, backgroundColor: colors.surface },
            ]}
          >
            {plays} plays
          </CueText>
        )}
      </View>
      <CheckControl
        checked={detail.watched}
        testID={TEST_IDS.episodeMarkControl}
        label={
          detail.watched
            ? "Watched. Tap to remove."
            : `Mark ${epCode(detail.season, detail.number)} watched`
        }
        onPress={onMark}
      />
    </View>
  );
}

export const detailMarkStyles = StyleSheet.create({
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
