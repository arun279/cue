import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Skeleton } from "../../ui/Skeleton";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, RADIUS, ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const SKELETON_ROWS = 4;
const BAR = { title: "55%", meta: "35%" } as const;
const BAR_HEIGHT = 12;

/** Where a calendar row's text starts, and so how far its separator is inset. */
export const AGENDA_TEXT_INSET = SPACE.s4 + POSTER_WIDTH.onTheWay + SPACE.s3;

export interface DayHeaderProps {
  readonly label: string;
  readonly count: number;
  readonly today: boolean;
}

/**
 * The pinned day band. Its `--color-bg` fill is load bearing rather than
 * decoration: it is the opaque surface that sits under the nav bar at every
 * scroll offset, and the only reason this screen may let the bar use the
 * platform's translucent material. It must not become a tinted or translucent
 * band.
 */
export function DayHeader({ label, count, today }: DayHeaderProps): ReactElement {
  const colors = useColors();

  return (
    <View
      testID={today ? TEST_IDS.calendarDayHeaderToday : TEST_IDS.calendarDayHeader}
      style={[styles.band, { backgroundColor: colors.bg }]}
    >
      <CueText
        variant="meta"
        weight="semibold"
        eyebrow
        accessibilityRole="header"
        style={[styles.bandLabel, { color: colors.muted }]}
      >
        {`${label} · ${count}`}
      </CueText>
    </View>
  );
}

/** One day bar and its rows, standing where the agenda will stand. */
export function AgendaSkeleton(): ReactElement {
  return (
    <View testID={TEST_IDS.calendarSkeleton} style={styles.skeleton}>
      <Skeleton width="30%" height={BAR_HEIGHT} />
      {SKELETON_SLOTS.map((slot) => (
        <View key={slot} style={styles.skeletonRow}>
          <Skeleton
            width={POSTER_WIDTH.onTheWay}
            height={ROW_MIN_HEIGHT.calendar}
            radius={RADIUS.poster}
          />
          <View style={styles.skeletonStack}>
            <Skeleton width={BAR.title} height={BAR_HEIGHT} />
            <Skeleton width={BAR.meta} height={BAR_HEIGHT} />
          </View>
        </View>
      ))}
    </View>
  );
}

const SKELETON_SLOTS = Array.from({ length: SKELETON_ROWS }, (_, index) => index);

const styles = StyleSheet.create({
  band: { paddingHorizontal: SPACE.s4, paddingTop: SPACE.s4, paddingBottom: SPACE.s2 },
  bandLabel: { textTransform: "uppercase" },
  skeleton: { paddingTop: SPACE.s3, gap: SPACE.s3 },
  skeletonRow: { flexDirection: "row", gap: SPACE.s3 },
  skeletonStack: { flex: 1, gap: SPACE.s2, paddingTop: SPACE.s1 },
});
