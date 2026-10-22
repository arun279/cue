import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useHideShow } from "@cue/core/hooks/useHideShow";
import { type Href, useRouter } from "expo-router";
import { memo, type ReactElement, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { Poster } from "../../ui/Poster";
import { ProgressBar } from "../../ui/ProgressBar";
import { itemActions, RowMenu, type RowMenuItem } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import { PALETTE, SPACE, TARGET_MIN, useColors, useStacked } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { ChipKey } from "./model";

const PLATE = { inset: 6, radius: 6 };
const TITLE_LINES = 2;
const MAX_COLUMNS = 3;
const MORE_INSET = (TARGET_MIN - 24) / 2;

const LONG_TITLE_WORD_WIDTH = 76;

export function usePosterGrid(): { readonly columns: number; readonly width: number } {
  const { width, fontScale } = useWindowDimensions();
  const row = width - 2 * SPACE.s4;
  const fit = Math.floor((row + SPACE.s3) / (LONG_TITLE_WORD_WIDTH * fontScale + SPACE.s3));
  const columns = Math.min(MAX_COLUMNS, Math.max(1, fit));
  return { columns, width: Math.floor((row - (columns - 1) * SPACE.s3) / columns) };
}

const STATUS_WORD: Readonly<Record<ChipKey, string>> = {
  watching: "watching",
  "not-started": "not started",
  stopped: "stopped",
  finished: "finished",
  watched: "watched",
};

export interface TileProps {
  readonly title: string;
  readonly posters: readonly string[] | null;
  readonly width: number;
  readonly label: string;
  readonly testID?: string;
  readonly percent: number | null;
  readonly left: number;
  readonly year?: string;
  readonly actions?: readonly RowMenuItem[];
  readonly trailing?: ReactNode;
  onPress(): void;
}

export function Tile({
  title,
  posters,
  width,
  label,
  testID,
  percent,
  left,
  year,
  actions = [],
  trailing,
  onPress,
}: TileProps): ReactElement {
  const colors = useColors();
  const stacked = useStacked();
  const counted = left > 0;

  return (
    <Pressable
      accessible
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={[styles.tile, { width }]}
      {...itemActions(actions)}
    >
      <View>
        <Poster title={title} posters={posters} width={width} />
        {percent === null ? null : (
          <View style={styles.rail}>
            <ProgressBar percent={percent} width="100%" />
          </View>
        )}
        {counted && !stacked ? (
          <View style={[styles.plate, styles.disc, { backgroundColor: colors.scrim }]}>
            <CueText variant="micro" tabularNums style={styles.plateText}>
              {left}
            </CueText>
          </View>
        ) : null}
        {year === undefined ? null : (
          <View style={[styles.plate, styles.year, { backgroundColor: colors.scrim }]}>
            <CueText variant="micro" tabularNums style={styles.plateText}>
              {year}
            </CueText>
          </View>
        )}
      </View>
      <View style={styles.caption}>
        <CueText
          variant="caption"
          numberOfLines={TITLE_LINES}
          style={[styles.title, { color: colors.fg }]}
        >
          {title}
        </CueText>
        {trailing === undefined ? null : <View style={styles.more}>{trailing}</View>}
      </View>
      {counted && stacked ? (
        <CueText variant="micro" tabularNums style={{ color: colors.ink2 }}>
          {left} left
        </CueText>
      ) : null}
    </Pressable>
  );
}

export interface ShowTileProps {
  readonly entry: LibraryEntry;
  readonly chip: ChipKey;
  readonly width: number;
}

export const ShowTile = memo(function ShowTile({
  entry,
  chip,
  width,
}: ShowTileProps): ReactElement {
  const router = useRouter();
  const hide = useHideShow();
  const listed = entry.posters.length > 0;
  const art = useShowArt(entry.showId, !listed);
  const left = chip === "watching" ? episodesLeft(entry.aired, entry.completed) : 0;
  const href: Href = `/show/${entry.showId}`;
  const open = (): void => router.push(href);
  const label = [entry.title, STATUS_WORD[chip], left > 0 ? `${left} episodes left` : null]
    .filter(Boolean)
    .join(", ");
  const actions: RowMenuItem[] = [
    { id: TEST_IDS.quickActionDetails, label: "Show details", onPress: open },
    entry.hidden
      ? {
          id: TEST_IDS.quickActionStop,
          label: "Resume watching",
          onPress: () =>
            void hide.unhide(
              entry.showId,
              { trakt: entry.showId, tmdb: entry.tmdbId ?? undefined },
              entry.title,
            ),
        }
      : {
          id: TEST_IDS.quickActionStop,
          label: "Stop watching",
          destructive: true,
          onPress: () => hide.stopWatching(entry),
        },
  ];

  return (
    <RowMenu
      title={entry.title}
      items={actions}
      testID={TEST_IDS.quickActions}
      item={{ href, label, testID: TEST_IDS.showCard(entry.showId), role: "link" }}
    >
      {(trigger, testID) => (
        <Tile
          title={entry.title}
          posters={listed ? entry.posters : art.posters}
          width={width}
          testID={testID}
          label={label}
          percent={chip === "watching" ? watchedPercent(entry.completed, entry.aired) : null}
          left={left}
          actions={actions}
          trailing={trigger ?? undefined}
          onPress={open}
        />
      )}
    </RowMenu>
  );
});

export const MovieTile = memo(function MovieTile({
  entry,
  chip,
  width,
}: {
  readonly entry: MovieEntry;
  readonly chip: ChipKey;
  readonly width: number;
}): ReactElement {
  const router = useRouter();
  return (
    <Tile
      title={entry.title}
      posters={entry.posters}
      width={width}
      testID={TEST_IDS.movieCard(entry.movieId)}
      label={`${entry.title}, ${STATUS_WORD[chip]}`}
      percent={null}
      left={0}
      onPress={() => router.push(`/movie/${entry.movieId}`)}
    />
  );
});

const styles = StyleSheet.create({
  tile: { gap: SPACE.s1 },
  caption: { flexDirection: "row", alignItems: "flex-start" },
  title: { flex: 1 },
  more: { marginTop: -MORE_INSET, marginRight: -MORE_INSET },
  rail: {
    position: "absolute",
    left: SPACE.s2,
    right: SPACE.s2,
    bottom: SPACE.s2,
  },
  plate: {
    position: "absolute",
    top: PLATE.inset,
    minWidth: SPACE.s5,
    paddingHorizontal: SPACE.s1,
    paddingVertical: 2,
    alignItems: "center",
    borderRadius: PLATE.radius,
  },
  disc: { right: PLATE.inset },
  year: { left: PLATE.inset },
  plateText: { color: PALETTE.onImage.dark },
});
