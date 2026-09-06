import type { TraktFailure } from "@cue/core/data/trakt/client";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { UpNextEmptyKind } from "@cue/core/domain/up-next";
import { readFailureBody } from "@cue/core/sync-contract";
import { useRouter } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Poster } from "../../ui/Poster";
import { SectionHeader } from "../../ui/SectionHeader";
import { Skeleton } from "../../ui/Skeleton";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, RADIUS, ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const SKELETON_ROWS = 6;
const BAR = { title: "60%", meta: "40%", count: 64 } as const;
const BAR_HEIGHT = 12;
const WATCHLIST_TILES = 3;
const TILE_WIDTH = 96;

/**
 * The state a first run actually starts in. Each plate stands where its content
 * will stand and is the size that content will be, so the screen tells the truth
 * about its own shape before it knows the words and nothing jumps when it
 * resolves. There is no spinner anywhere: Cue has one loading vocabulary.
 */
export function UpNextSkeleton(): ReactElement {
  return (
    <View testID={TEST_IDS.upNextSkeleton}>
      <Skeleton width="100%" height={ROW_MIN_HEIGHT.marquee} radius={RADIUS.card} />
      <View style={styles.skeletonRows}>
        {SKELETON_SLOTS.map((slot) => (
          <View key={slot} style={styles.skeletonRow}>
            <Skeleton
              width={POSTER_WIDTH.row}
              height={ROW_MIN_HEIGHT.queue}
              radius={RADIUS.poster}
            />
            <View style={styles.skeletonStack}>
              <Skeleton width={BAR.title} height={BAR_HEIGHT} />
              <Skeleton width={BAR.meta} height={BAR_HEIGHT} />
              <Skeleton width={BAR.count} height={BAR_HEIGHT} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const SKELETON_SLOTS = Array.from({ length: SKELETON_ROWS }, (_, index) => index);

/**
 * The screen with nothing cached to fall back on. Centred, which is the only
 * non-color signal separating "this went wrong" from "there is nothing here":
 * an empty state aligns to the leading edge and never looks like this.
 */
export function UpNextError({
  failure,
  onRetry,
}: {
  readonly failure: TraktFailure | null;
  onRetry(): void;
}): ReactElement {
  return (
    <EmptyState
      testID="up-next-error"
      centered
      headline="Couldn't load your queue"
      body={readFailureBody(failure)}
    >
      <Button label="Retry" onPress={onRetry} testID="up-next-error-retry" />
    </EmptyState>
  );
}

/**
 * The media-visibility branch, which is not one of the five: it is decided by a
 * Settings switch rather than by what the library holds, and it issues no show
 * reads at all. The copy is new, written in the grammar of the movie notice it
 * mirrors, so the two media stay symmetric.
 */
export function TvShowsOff(): ReactElement {
  const router = useRouter();

  return (
    <EmptyState
      testID="up-next-tv-off"
      headline="TV shows are turned off."
      body="Turn TV shows back on in Settings to see your queue."
    >
      <Button label="Open Settings" variant="link" onPress={() => router.push("/settings")} />
    </EmptyState>
  );
}

interface EmptyCopy {
  readonly testID: string;
  readonly headline: string;
  readonly body?: string;
}

/** Verbatim from the shipped screens. */
const EMPTY: Readonly<Record<UpNextEmptyKind, EmptyCopy>> = {
  "nothing-tracked": {
    testID: TEST_IDS.upNextEmptyNothingQueued,
    headline: "Nothing queued.",
    body: "Find a show and Cue keeps your place.",
  },
  "only-stopped": {
    testID: TEST_IDS.upNextEmptyOnlyStopped,
    headline: "All your shows are stopped.",
    body: "Resume one to bring it back into your queue. Your watch history is kept.",
  },
  "nothing-started": {
    testID: TEST_IDS.upNextEmptyNothingStarted,
    headline: "Nothing queued.",
    body: "Find a show and Cue keeps your place.",
  },
  unresolved: {
    testID: TEST_IDS.upNextEmptyNothingQueued,
    headline: "Nothing to queue right now.",
    body: "Shows with episodes left are waiting in your Library.",
  },
  "caught-up": { testID: TEST_IDS.upNextEmptyAllCaughtUp, headline: "You're all caught up." },
};

const SEARCH_BRANCHES: readonly UpNextEmptyKind[] = ["nothing-tracked", "nothing-started"];
const LIBRARY_BRANCHES: readonly UpNextEmptyKind[] = ["only-stopped", "unresolved"];

export interface UpNextEmptyProps {
  readonly kind: UpNextEmptyKind;
  /** Things the reader already said they wanted: the one place an empty screen
   * has something better to offer than a search field. */
  readonly watchlist: readonly LibraryEntry[];
  /** "On the way", which is what answers "so when do I get something?" in the
   * branches where the queue cannot resolve. Null when nothing is coming. */
  readonly onTheWay: ReactNode;
}

/**
 * The five branches, each aligned to the leading edge, because genuine emptiness
 * reads as success rather than as failure and must not be drawn like an error.
 */
export function UpNextEmpty({ kind, watchlist, onTheWay }: UpNextEmptyProps): ReactElement {
  const router = useRouter();
  const copy = EMPTY[kind];
  // The caught-up sentence is only true when nothing is coming. With something
  // on the way the section below is the answer and a second line is noise.
  const body =
    kind === "caught-up" && onTheWay === null ? "Nothing airing in the next few days." : copy.body;

  return (
    <>
      <EmptyState testID={copy.testID} headline={copy.headline} body={body}>
        {SEARCH_BRANCHES.includes(kind) ? (
          <Button label="Search shows" onPress={() => router.push("/search")} />
        ) : null}
        {LIBRARY_BRANCHES.includes(kind) ? (
          <Button label="Go to Library" variant="ghost" onPress={() => router.push("/library")} />
        ) : null}
      </EmptyState>
      {kind === "nothing-started" && watchlist.length > 0 ? (
        <WatchlistTiles entries={watchlist} />
      ) : null}
      {onTheWay}
    </>
  );
}

function WatchlistTiles({ entries }: { readonly entries: readonly LibraryEntry[] }): ReactElement {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={styles.tiles}>
      <SectionHeader label="From your watchlist" />
      <View style={styles.tileRow}>
        {entries.slice(0, WATCHLIST_TILES).map((entry) => (
          <Pressable
            key={entry.showId}
            accessible
            accessibilityRole="button"
            accessibilityLabel={entry.title}
            testID="watchlist-tile"
            onPress={() => router.push(`/show/${entry.showId}`)}
            style={styles.tile}
          >
            <Poster title={entry.title} width={TILE_WIDTH} />
            <CueText variant="caption" style={{ color: colors.ink2 }}>
              {entry.title}
            </CueText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRows: { paddingTop: SPACE.s3, gap: SPACE.s3 },
  skeletonRow: { flexDirection: "row", gap: SPACE.s3 },
  skeletonStack: { flex: 1, gap: SPACE.s2, paddingTop: SPACE.s1 },
  tiles: { paddingTop: SPACE.s4, gap: SPACE.s2 },
  tileRow: { flexDirection: "row", gap: SPACE.s3 },
  tile: { flex: 1, gap: SPACE.s2 },
});
