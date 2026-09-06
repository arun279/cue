import { quickMarkable } from "@cue/core/data/trakt/library";
import { epCode } from "@cue/core/domain/model/library";
import { episodesLeft, lastWatchedPhrase, watchedPercent } from "@cue/core/format";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import type { UpNextCard } from "@cue/core/hooks/useUpNext";
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

const STOP_LABEL = "Stop show";

export interface QueueRowProps {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
  onStop(): void;
  /** The lapsed variant draws the idle stretch where the queue draws its count,
   * which is the reason the row is in the drawer at all. */
  readonly variant?: "queue" | "lapsed";
}

/**
 * One queue-anatomy row: a 48 pt poster, the show, a quiet episode line, and a
 * footer holding the progress rail beside its count, with the check trailing.
 * Swipe right marks through the identical pipeline the check uses; swipe left
 * stops the show, and the overflow beside the check is the tap path to both.
 *
 * Exactly two accessibility elements plus the overflow: the body carries one
 * composed label in visual reading order, and the check is a sibling switch
 * rather than a control nested inside a button.
 */
export function QueueRow({ card, mark, onStop, variant = "queue" }: QueueRowProps): ReactElement {
  const { entry, item } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const art = useShowArt(entry.showId);

  const code = epCode(item.episode.season, item.episode.number);
  const episodeTitle = item.episode.title;
  const left = episodesLeft(entry.aired, entry.completed);
  const idle = variant === "lapsed" ? lastWatchedPhrase(entry.lastWatchedAt, Date.now()) : null;
  // Never "0 left": a projection that has run past a show's last aired episode
  // has nothing to count, and claiming zero is a number the app cannot stand by.
  const note = idle !== null ? `last watched ${idle}` : left > 0 ? `${left} left` : null;
  const open = (): void => router.push(`/show/${entry.showId}`);

  const markable = control.state === "unwatched";
  const markLabel = `Mark ${code} watched`;

  return (
    <SwipeRow
      testID={
        variant === "lapsed" ? TEST_IDS.lapsedRow(entry.showId) : TEST_IDS.queueRow(entry.showId)
      }
      onMark={markable ? control.onPress : undefined}
      onStop={onStop}
    >
      <View style={[styles.surface, { backgroundColor: colors.bg }]}>
        <Row
          label={[entry.title, code, episodeTitle, note].filter(Boolean).join(", ")}
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
                ]}
              />
              <CheckControl
                checked={control.state !== "unwatched"}
                disabled={control.state === "advancing"}
                pending={control.pending}
                label={control.label}
                size={CHECK_SIZE.row}
                onPress={control.onPress}
                testID={
                  variant === "lapsed"
                    ? TEST_IDS.lapsedRowMark(entry.showId)
                    : TEST_IDS.queueRowMark(entry.showId)
                }
              />
            </>
          }
        >
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            {entry.title}
          </CueText>
          <CueText variant="meta" style={{ color: colors.ink2 }}>
            {code}
            {episodeTitle === null ? "" : ` · ${episodeTitle}`}
          </CueText>
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
  // Opaque, so the swipe reveal stays behind the row it is revealed by.
  surface: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
});
