import { quickMarkable } from "@cue/core/data/trakt/library";
import { type EpisodeRef, epCode } from "@cue/core/domain/model/library";
import { lastWatchedPhrase, leftNote, watchedPercent, withEpisodeTitle } from "@cue/core/format";
import { useAlertsMute } from "@cue/core/hooks/useAlertsMute";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { CheckControl } from "../../ui/CheckControl";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { RowFooter } from "../../ui/RowFooter";
import { RowMenu } from "../../ui/RowMenu";
import { SwipeRow } from "../../ui/SwipeRow";
import { TEST_IDS } from "../../ui/test-ids";
import { CHECK_SIZE, POSTER_WIDTH, RAIL, ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { UpNextCard } from "./model";

const STOP_LABEL = "Stop show";
const ROW_IDS = {
  queue: { row: TEST_IDS.queueRow, mark: TEST_IDS.queueRowMark },
  lapsed: { row: TEST_IDS.lapsedRow, mark: TEST_IDS.lapsedRowMark },
};

export interface QueueRowProps {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
  onStop(): void;
  readonly variant?: "queue" | "lapsed";
}

function episodeText(episode: EpisodeRef | null) {
  if (episode === null) return { code: null, title: null, meta: null };
  const code = epCode(episode.season, episode.number);
  return { code, title: episode.title, meta: withEpisodeTitle(code, episode.title) };
}

export function QueueRow({ card, mark, onStop, variant = "queue" }: QueueRowProps): ReactElement {
  const { entry, item } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const art = useShowArt(entry.showId);
  const alerts = useAlertsMute(entry.showId, entry.title);

  const { code, title, meta } = episodeText(item.episode);
  const idle = variant === "lapsed" ? lastWatchedPhrase(entry.lastWatchedAt, Date.now()) : null;
  const note = idle !== null ? `last watched ${idle}` : leftNote(entry.aired, entry.completed);
  const open = (): void => router.push(`/show/${entry.showId}`);

  const markable = control.state === "unwatched";
  const markLabel = code === null ? `Mark ${entry.title} watched` : `Mark ${code} watched`;

  return (
    <SwipeRow
      testID={ROW_IDS[variant].row(entry.showId)}
      onMark={markable ? control.onPress : undefined}
      onStop={onStop}
    >
      <View style={[styles.surface, { backgroundColor: colors.bg }]}>
        <Row
          label={[entry.title, code, title, note].filter(Boolean).join(", ")}
          minHeight={ROW_MIN_HEIGHT.queue}
          onPress={open}
          actions={[
            ...(markable ? [{ name: "mark", label: markLabel, onPress: control.onPress }] : []),
            { name: "stop", label: STOP_LABEL, onPress: onStop },
          ]}
          leading={<Poster title={entry.title} posters={art.posters} width={POSTER_WIDTH.row} />}
          trailing={
            <>
              <RowMenu
                title={entry.title}
                testID={TEST_IDS.quickActions}
                items={[
                  {
                    id: TEST_IDS.quickActionMark,
                    label: markLabel,
                    available: quickMarkable(entry, Date.now()),
                    onPress: () => void mark.mark(entry),
                  },
                  { id: TEST_IDS.quickActionStop, label: STOP_LABEL, onPress: onStop },
                  { id: TEST_IDS.quickActionDetails, label: "Show details", onPress: open },
                  ...(variant === "queue"
                    ? [
                        {
                          id: TEST_IDS.quickActionMute,
                          label: alerts.label,
                          onPress: alerts.toggle,
                        },
                      ]
                    : []),
                ]}
              />
              <CheckControl
                checked={control.state !== "unwatched"}
                disabled={control.state === "advancing"}
                pending={control.pending}
                label={control.label}
                size={CHECK_SIZE.row}
                onPress={control.onPress}
                testID={ROW_IDS[variant].mark(entry.showId)}
              />
            </>
          }
        >
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            {entry.title}
          </CueText>
          {meta === null ? null : (
            <CueText variant="meta" style={{ color: colors.ink2 }}>
              {meta}
            </CueText>
          )}
          <RowFooter
            percent={watchedPercent(entry.completed, entry.aired)}
            note={note}
            rail={RAIL.row}
            color={colors.muted}
          />
        </Row>
      </View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  surface: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
});
