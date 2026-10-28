import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { LibraryEntry } from "@/core/data/trakt/library";
import { epCode } from "@/core/domain/model/library";
import { continuePosition, episodeCount, returnsLine } from "@/core/domain/show-detail";
import { watchedPercent } from "@/core/format";
import { useMarkControl } from "@/core/hooks/useMarkControl";
import type { MarkWatched } from "@/core/hooks/useMarkWatched";
import { useMarkStore } from "@/core/stores/mark-store";
import { CheckControl } from "../../ui/CheckControl";
import { ProgressBar } from "../../ui/ProgressBar";
import { Row } from "../../ui/Row";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function ContinueBar({
  entry,
  mark,
}: {
  readonly entry: LibraryEntry;
  readonly mark: MarkWatched;
}): ReactElement {
  const colors = useColors();
  const position = continuePosition(entry, Date.now());
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {position.kind === "next" ? (
        <NextEpisode entry={entry} mark={mark} />
      ) : (
        <>
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            {position.kind === "finished" ? "Ended. You finished it." : "All caught up"}
          </CueText>
          {position.kind === "returning" && (
            <CueText variant="caption" style={{ color: colors.muted }}>
              {returnsLine(position)}
            </CueText>
          )}
        </>
      )}
    </View>
  );
}

function NextEpisode({
  entry,
  mark,
}: {
  readonly entry: LibraryEntry;
  readonly mark: MarkWatched;
}): ReactElement {
  const colors = useColors();
  const router = useRouter();
  const control = useMarkControl(entry, mark);
  const record = useMarkStore((state) => state.records.get(entry.showId));
  const justMarked = control.state === "just-marked" && record !== undefined;
  const episode = justMarked
    ? { season: record.season, number: record.number, title: record.beforeMark.nextEpisode?.title }
    : entry.nextEpisode;
  const title =
    episode === null
      ? "Finding your next episode"
      : [epCode(episode.season, episode.number), episode.title].filter(Boolean).join(" · ");
  const count =
    entry.completed === 0
      ? episodeCount(entry.aired)
      : `${entry.completed} of ${entry.aired} watched · ${entry.left} left`;
  return (
    <Row
      label={`${title}, ${count}`}
      minHeight={72}
      onPress={
        episode === null
          ? undefined
          : () => router.push(`/show/${entry.showId}/episode/${episode.season}/${episode.number}`)
      }
      trailing={
        episode === null ? null : (
          <CheckControl
            checked={justMarked}
            label={
              justMarked
                ? control.label
                : `Mark ${entry.title} ${epCode(episode.season, episode.number)} watched`
            }
            disabled={control.state === "advancing"}
            pending={control.pending}
            onPress={control.onPress}
            testID={TEST_IDS.continueMark}
          />
        )
      }
    >
      <CueText variant="micro" eyebrow style={{ color: colors.muted }}>
        {entry.completed === 0 ? "Start watching" : "Next"}
      </CueText>
      <CueText variant="rowTitle" style={{ color: colors.fg }}>
        {title}
      </CueText>
      <CueText variant="caption" style={{ color: colors.muted }}>
        {count}
      </CueText>
      <ProgressBar width="100%" percent={watchedPercent(entry.completed, entry.aired)} />
    </Row>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: SPACE.s3,
    gap: SPACE.s1,
    minHeight: 72,
    justifyContent: "center",
  },
});
