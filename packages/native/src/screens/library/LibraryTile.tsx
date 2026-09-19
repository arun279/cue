import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useHideShow } from "@cue/core/hooks/useHideShow";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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

/** What the tile says it is, which the overlays never say on their own. */
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
  /** The Watching overlay: a rail and a number, never a color on its own. Both
   * are absent on the chips whose grid is already one status throughout. */
  readonly percent: number | null;
  readonly left: number;
  readonly year?: string;
  onPress(): void;
}

/**
 * One cell of the poster grid: artwork at 2:3, the title under it, and on the
 * Watching chip how far through the show the reader is.
 *
 * The count sits in a disc over the poster until the type outgrows it. Artwork
 * does not scale with Dynamic Type, so past the reflow scale the number leaves
 * the plate and becomes a caption line under the title, which is where the
 * tile's composed label already puts it.
 */
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
  /** Artwork is read for the tiles the list reports on screen, not for every
   * tile it keeps mounted either side of them. */
  readonly onScreen: boolean;
}

/**
 * A show tile, with the platform's preview and context menu on long press. The
 * cell itself is the link, so the menu carries no overflow control of its own
 * and every action on it also exists on the show screen.
 */
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
