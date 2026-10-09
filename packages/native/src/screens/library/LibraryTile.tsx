import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useHideShow } from "@cue/core/hooks/useHideShow";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { Poster } from "../../ui/Poster";
import { ProgressBar } from "../../ui/ProgressBar";
import { RowMenu } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import { PALETTE, SPACE, useColors, useStacked } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { ChipKey } from "./model";

const PLATE = { inset: 6, radius: 6 };
const TITLE_LINES = 2;
const MAX_COLUMNS = 3;

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
  watchlist: "on your watchlist",
  stopped: "stopped",
  finished: "finished",
  watched: "watched",
};

export interface TileProps {
  readonly title: string;
  readonly posters: readonly string[] | null;
  readonly width: number;
  readonly label: string;
  readonly testID: string;
  readonly percent: number | null;
  readonly left: number;
  readonly year?: string;
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
      <CueText variant="caption" numberOfLines={TITLE_LINES} style={{ color: colors.fg }}>
        {title}
      </CueText>
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
  readonly onScreen: boolean;
}

export function ShowTile({ entry, chip, width, onScreen }: ShowTileProps): ReactElement {
  const router = useRouter();
  const hide = useHideShow();
  const art = useShowArt(entry.showId, onScreen);
  const left = episodesLeft(entry.aired, entry.completed);
  const open = (): void => router.push(`/show/${entry.showId}`);

  return (
    <RowMenu
      title={entry.title}
      testID={TEST_IDS.quickActions}
      items={[
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
      ]}
    >
      <Tile
        title={entry.title}
        posters={art.posters}
        width={width}
        testID={TEST_IDS.showCard(entry.showId)}
        label={[entry.title, STATUS_WORD[chip], left > 0 ? `${left} episodes left` : null]
          .filter(Boolean)
          .join(", ")}
        percent={chip === "watching" ? watchedPercent(entry.completed, entry.aired) : null}
        left={chip === "watching" ? left : 0}
        onPress={open}
      />
    </RowMenu>
  );
}

export function MovieTile({
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
}

const styles = StyleSheet.create({
  tile: { gap: SPACE.s1 },
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
