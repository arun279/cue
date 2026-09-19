import type { SearchHit } from "@cue/core/data/trakt/search";
import { useRouter } from "expo-router";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge } from "../../ui/Badge";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { TEST_IDS } from "../../ui/test-ids";
import {
  POSTER_WIDTH,
  RADIUS,
  ROW_MIN_HEIGHT,
  SPACE,
  TARGET_MIN,
  useColors,
} from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { labelOf, MEDIUM, routeOf } from "./model";

/** How long the filled confirmation holds before settling into "In library". */
const ADDED_FLASH_MS = 600;

/** The pill's ink, with `hitSlop` making up the rest of the tap target. */
const PILL = { height: 32, stroke: 1 } as const;
const SLOP = (TARGET_MIN - PILL.height) / 2;

export interface ResultRowProps {
  readonly hit: SearchHit;
  /** Already in the reader's library, optimistically or from Trakt. */
  readonly added: boolean;
  onAdd(hit: SearchHit): void;
}

/**
 * One search result: poster, title with its medium beside it, release year
 * under that, and the app's one optimistic control at the trailing edge. The
 * body is the link into detail, so no control ever covers poster art.
 */
export function ResultRow({ hit, added, onAdd }: ResultRowProps): ReactElement {
  const router = useRouter();
  const colors = useColors();
  const [flashing, setFlashing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const press = (): void => {
    setFlashing(true);
    timer.current = setTimeout(() => setFlashing(false), ADDED_FLASH_MS);
    onAdd(hit);
  };

  return (
    <View style={styles.row}>
      <Row
        label={labelOf(hit)}
        minHeight={ROW_MIN_HEIGHT.search}
        testID={TEST_IDS.searchResult(hit.traktId)}
        leading={<Poster title={hit.title} posters={hit.posters} width={POSTER_WIDTH.row} />}
        trailing={<AddPill hit={hit} added={added} flashing={flashing} onPress={press} />}
        onPress={() => router.push(routeOf(hit))}
      >
        <View style={styles.title}>
          <CueText variant="rowTitleSecondary" style={{ color: colors.fg }}>
            {hit.title}
          </CueText>
          <Badge label={MEDIUM[hit.type]} />
        </View>
        {hit.year === null ? null : (
          <CueText variant="meta" tabularNums style={{ color: colors.muted }}>
            {hit.year}
          </CueText>
        )}
      </Row>
    </View>
  );
}

/**
 * Three faces and one control. The offer is outlined rather than filled, so the
 * 600 ms confirmation is the one moment amber fills anything on this screen;
 * what it settles into is a statement, not an offer, because Trakt has no single
 * operation that would take an add back and a control that cannot act is worse
 * than no control at all.
 */
function AddPill({
  hit,
  added,
  flashing,
  onPress,
}: {
  readonly hit: SearchHit;
  readonly added: boolean;
  readonly flashing: boolean;
  onPress(): void;
}): ReactElement {
  const colors = useColors();

  if (flashing) {
    return (
      <View
        testID={TEST_IDS.searchAdded}
        style={[
          styles.pill,
          { backgroundColor: colors.accent, borderColor: colors.accentFillStroke },
        ]}
      >
        <CueText variant="meta" weight="semibold" style={{ color: colors.accentFg }}>
          Added ✓
        </CueText>
      </View>
    );
  }
  if (added) {
    return (
      <CueText testID={TEST_IDS.searchInLibrary} variant="caption" style={{ color: colors.muted }}>
        In library
      </CueText>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${hit.title} to Watchlist`}
      testID={TEST_IDS.searchResultWatchlist(hit.traktId)}
      hitSlop={SLOP}
      onPress={onPress}
      style={[styles.pill, { borderColor: colors.accentInk }]}
    >
      <CueText variant="meta" weight="semibold" style={{ color: colors.accentInk }}>
        + Watchlist
      </CueText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
  title: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s2 },
  pill: {
    flexShrink: 0,
    minHeight: PILL.height,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACE.s3,
    borderWidth: PILL.stroke,
    borderRadius: RADIUS.pill,
  },
});
