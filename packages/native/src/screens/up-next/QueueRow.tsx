import { quickMarkable } from "@cue/core/data/trakt/library";
import { airedLastNight } from "@cue/core/domain/day";
import { type EpisodeRef, epCode } from "@cue/core/domain/model/library";
import { localTimeZone, toMs } from "@cue/core/domain/time";
import { lastWatchedPhrase, leftNote, watchedPercent, withEpisodeTitle } from "@cue/core/format";
import { useAlertsMute } from "@cue/core/hooks/useAlertsMute";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { Badge } from "../../ui/Badge";
import { PendingDot } from "../../ui/CheckControl";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { RowFooter } from "../../ui/RowFooter";
import { RowMenu, type RowMenuItem } from "../../ui/RowMenu";
import { SwipeRow } from "../../ui/SwipeRow";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, RAIL, ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { UpNextCard } from "./model";

const AIRED_LAST_NIGHT = "Aired last night";
const ROW_IDS = {
  queue: { row: TEST_IDS.queueRow, body: TEST_IDS.queueRowBody },
  lapsed: { row: TEST_IDS.lapsedRow, body: TEST_IDS.lapsedRowBody },
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

function episodeAiredLastNight(episode: EpisodeRef | null, now: number): boolean {
  return airedLastNight(toMs(episode?.firstAired ?? null), now, localTimeZone());
}

export function QueueRow({ card, mark, onStop, variant = "queue" }: QueueRowProps): ReactElement {
  const { entry, item } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const art = useShowArt(entry.showId);
  const alerts = useAlertsMute(entry.showId, entry.title);
  const { width } = useWindowDimensions();
  const now = Date.now();

  const { code, title, meta } = episodeText(item.episode);
  const idle = variant === "lapsed" ? lastWatchedPhrase(entry.lastWatchedAt, now) : null;
  const note = idle !== null ? `last watched ${idle}` : leftNote(entry.aired, entry.completed);
  const fresh = variant === "queue" && episodeAiredLastNight(item.episode, now);
  const open = (): void => router.push(`/show/${entry.showId}`);
  const markable = control.state === "unwatched" && quickMarkable(entry, now);

  const items: RowMenuItem[] = [
    {
      id: TEST_IDS.quickActionMark,
      label: code === null ? `Mark ${entry.title} watched` : `Mark ${code} watched`,
      available: markable,
      onPress: control.onPress,
    },
    { id: TEST_IDS.quickActionStop, label: "Stop show", onPress: onStop },
    { id: TEST_IDS.quickActionDetails, label: "Show details", onPress: open },
    ...(variant === "queue"
      ? [{ id: TEST_IDS.quickActionMute, label: alerts.label, onPress: alerts.toggle }]
      : []),
  ];

  return (
    <SwipeRow
      testID={ROW_IDS[variant].row(entry.showId)}
      onMark={markable ? control.onPress : undefined}
      onStop={onStop}
    >
      <RowMenu
        title={entry.title}
        items={items}
        testID={TEST_IDS.quickActions}
        contentWidth={width}
      >
        {(trigger) => (
          <View style={[styles.surface, { backgroundColor: colors.bg }]}>
            <Row
              label={[
                entry.title,
                fresh ? AIRED_LAST_NIGHT : null,
                code,
                title,
                note,
                control.pending ? "not synced yet" : null,
              ]
                .filter(Boolean)
                .join(", ")}
              minHeight={ROW_MIN_HEIGHT.queue}
              onPress={open}
              testID={ROW_IDS[variant].body(entry.showId)}
              actions={items}
              leading={
                <Poster title={entry.title} posters={art.posters} width={POSTER_WIDTH.row} />
              }
              trailing={
                control.pending || trigger !== null ? (
                  <>
                    {control.pending ? <PendingDot /> : null}
                    {trigger}
                  </>
                ) : undefined
              }
            >
              <CueText variant="rowTitle" style={{ color: colors.fg }}>
                {entry.title}
              </CueText>
              {meta === null ? null : (
                <View style={styles.meta}>
                  <CueText variant="meta" style={[styles.metaText, { color: colors.ink2 }]}>
                    {meta}
                  </CueText>
                  {fresh ? <Badge label={AIRED_LAST_NIGHT} /> : null}
                </View>
              )}
              <RowFooter
                percent={watchedPercent(entry.completed, entry.aired)}
                note={note}
                rail={RAIL.row}
                color={colors.muted}
              />
            </Row>
          </View>
        )}
      </RowMenu>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  surface: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s2 },
  metaText: { flexShrink: 1 },
});
