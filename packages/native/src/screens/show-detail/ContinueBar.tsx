import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { epCode } from "@cue/core/domain/model/library";
import { continueKind, episodeCount, returnsLine } from "@cue/core/domain/show-detail";
import { watchedPercent } from "@cue/core/format";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { CheckControl } from "../../ui/CheckControl";
import { ProgressBar } from "../../ui/ProgressBar";
import { Row } from "../../ui/Row";
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
  const kind = continueKind(entry, Date.now());
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {kind === "next" ? (
        <NextEpisode entry={entry} mark={mark} />
      ) : (
        <>
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            {kind === "finished" ? "Ended. You finished it." : "All caught up"}
          </CueText>
          {kind === "returning" && entry.nextEpisode !== null && (
            <CueText variant="caption" style={{ color: colors.muted }}>
              {returnsLine(entry.nextEpisode, Date.now())}
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
  const episode = entry.nextEpisode;
  const title =
    episode === null
      ? "Finding your next episode"
      : [epCode(episode.season, episode.number), episode.title].filter(Boolean).join(" · ");
  const count =
    entry.completed === 0
      ? episodeCount(entry.aired)
      : `${entry.completed} of ${entry.aired} watched · ${Math.max(0, entry.aired - entry.completed)} left`;
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
            checked={control.state !== "unwatched"}
            label={control.label}
            disabled={control.state === "advancing"}
            pending={control.pending}
            onPress={control.onPress}
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
