import { type LibraryEntry, quickMarkable } from "@cue/core/data/trakt/library";
import { airedLastNight } from "@cue/core/domain/day";
import { type EpisodeRef, epCode } from "@cue/core/domain/model/library";
import { localTimeZone, toMs } from "@cue/core/domain/time";
import { lastWatchedPhrase, leftNote, watchedPercent, withEpisodeTitle } from "@cue/core/format";
import { useAlertsMute } from "@cue/core/hooks/useAlertsMute";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useRouter } from "expo-router";
import { memo, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { Badge } from "../../ui/Badge";
import { PendingDot } from "../../ui/CheckControl";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { RowFooter } from "../../ui/RowFooter";
import { RowMenu, type RowMenuItem } from "../../ui/RowMenu";
import { SwipeRow } from "../../ui/SwipeRow";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, RAIL, ROW_MIN_HEIGHT, SPACE, TITLE_LINES, useColors } from "../../ui/tokens";
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
  onStop(entry: LibraryEntry): void;
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

function rowLabel(
  show: string,
  fresh: boolean,
  details: readonly (string | null)[],
  pending: boolean,
): string {
  return [show, fresh ? AIRED_LAST_NIGHT : null, ...details, pending ? "not synced yet" : null]
    .filter(Boolean)
    .join(", ");
}

function RowPoster({ showId, title }: { readonly showId: number; readonly title: string }) {
  const art = useShowArt(showId);
  return <Poster title={title} posters={art.posters} width={POSTER_WIDTH.row} />;
}

function QueueRowContent({ card, mark, onStop, variant = "queue" }: QueueRowProps): ReactElement {
  const { entry, item } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const alerts = useAlertsMute(entry.showId, entry.title);
  const now = Date.now();

  const { code, title, meta } = episodeText(item.episode);
  const idle = variant === "lapsed" ? lastWatchedPhrase(entry.lastWatchedAt, now) : null;
  const note = idle !== null ? `last watched ${idle}` : leftNote(entry.left);
  const fresh = variant === "queue" && episodeAiredLastNight(item.episode, now);
  const open = (): void => router.push(`/show/${entry.showId}`);
  const stop = (): void => onStop(entry);
  const markable = control.state === "unwatched" && quickMarkable(entry, now);
  const label = rowLabel(entry.title, fresh, [code, title, note], control.pending);

  const items: RowMenuItem[] = [
    {
      id: TEST_IDS.quickActionMark,
      label: code === null ? `Mark ${entry.title} watched` : `Mark ${code} watched`,
      available: markable,
      onPress: control.onPress,
    },
    { id: TEST_IDS.quickActionStop, label: "Stop show", onPress: stop },
    { id: TEST_IDS.quickActionDetails, label: "Show details", onPress: open },
    ...(variant === "queue"
      ? [{ id: TEST_IDS.quickActionMute, label: alerts.label, onPress: alerts.toggle }]
      : []),
  ];

  return (
    <SwipeRow
      testID={ROW_IDS[variant].row(entry.showId)}
      onMark={markable ? control.onPress : undefined}
      onStop={stop}
    >
      <RowMenu
        title={entry.title}
        items={items}
        testID={TEST_IDS.quickActions}
        item={{
          href: `/show/${entry.showId}`,
          label,
          testID: ROW_IDS[variant].body(entry.showId),
        }}
      >
        {(trigger, bodyTestID) => (
          <View style={[styles.surface, { backgroundColor: colors.bg }]}>
            <Row
              label={label}
              minHeight={ROW_MIN_HEIGHT.queue}
              onPress={open}
              testID={bodyTestID}
              actions={items}
              leading={<RowPoster showId={entry.showId} title={entry.title} />}
              trailing={
                control.pending || trigger !== null ? (
                  <>
                    {control.pending ? <PendingDot /> : null}
                    {trigger}
                  </>
                ) : undefined
              }
            >
              <CueText variant="rowTitle" numberOfLines={TITLE_LINES} style={{ color: colors.fg }}>
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

export const QueueRow = memo(QueueRowContent);

const styles = StyleSheet.create({
  surface: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s2 },
  metaText: { flexShrink: 1 },
});
