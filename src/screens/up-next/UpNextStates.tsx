import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { TraktFailure } from "@/core/domain/read-failure";
import type { UpNextEmptyKind } from "@/core/domain/up-next";
import { readFailureBody } from "@/core/sync-contract";
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

export function UpNextSkeleton(): ReactElement {
  return (
    <View testID={TEST_IDS.upNextSkeleton}>
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

export function UpNextError({
  failure,
  onRetry,
}: {
  readonly failure: TraktFailure | null;
  onRetry(): void;
}): ReactElement {
  return (
    <EmptyState
      testID={TEST_IDS.upNextError}
      centered
      headline="Couldn't load your queue"
      body={readFailureBody(failure)}
    >
      <Button label="Retry" onPress={onRetry} />
    </EmptyState>
  );
}

export function UpNextRetrying({
  failure,
}: {
  readonly failure: TraktFailure | null;
}): ReactElement {
  return (
    <EmptyState
      testID={TEST_IDS.upNextRetrying}
      centered
      headline="Still trying to reach Trakt"
      body={readFailureBody(failure)}
    />
  );
}

interface EmptyCopy {
  readonly headline: string;
  readonly body?: string;
}

const EMPTY: Readonly<Record<UpNextEmptyKind, EmptyCopy>> = {
  "nothing-tracked": {
    headline: "Nothing queued.",
    body: "Find a show and Cue keeps your place.",
  },
  "only-stopped": {
    headline: "All your shows are stopped.",
    body: "Resume one to bring it back into your queue. Your watch history is kept.",
  },
  "nothing-started": {
    headline: "Nothing queued.",
    body: "Find a show and Cue keeps your place.",
  },
  unresolved: {
    headline: "Nothing to queue right now.",
    body: "Shows with episodes left are waiting in your Library.",
  },
  "caught-up": { headline: "You're all caught up." },
};

const SEARCH_BRANCHES: readonly UpNextEmptyKind[] = ["nothing-tracked", "nothing-started"];
const LIBRARY_BRANCHES: readonly UpNextEmptyKind[] = ["only-stopped", "unresolved"];

export interface UpNextEmptyProps {
  readonly kind: UpNextEmptyKind;
  readonly watchlist: readonly LibraryEntry[];
  readonly airingSoon: boolean;
}

export function UpNextEmpty({ kind, watchlist, airingSoon }: UpNextEmptyProps): ReactElement {
  const router = useRouter();
  const copy = EMPTY[kind];
  const body =
    kind === "caught-up" && !airingSoon ? "Nothing airing in the next few days." : copy.body;

  return (
    <>
      <EmptyState headline={copy.headline} body={body}>
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
  skeletonRows: { gap: SPACE.s3 },
  skeletonRow: { flexDirection: "row", gap: SPACE.s3 },
  skeletonStack: { flex: 1, gap: SPACE.s2, paddingTop: SPACE.s1 },
  tiles: { paddingTop: SPACE.s4, gap: SPACE.s2 },
  tileRow: { flexDirection: "row", gap: SPACE.s3 },
  tile: { flex: 1, gap: SPACE.s2 },
});
