import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLiveRegion } from "./live-region";
import { TEST_IDS } from "./test-ids";
import { RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

/**
 * Ambient sync state, in precedence order. Offline outranks everything, because
 * an offline device always fails its reads and "your marks are saved" is the
 * honest message. Rate limited outranks the read error, and it is the more
 * specific of the two: the error offers Retry and this one deliberately does
 * not, because retrying is what caused it. Healthy is nothing at all, so it is
 * not a state here: silence means synced, and no space is held for a strip.
 */
export type SyncStripProps =
  | { readonly state: "offline" }
  | { readonly state: "rate-limited" }
  | { readonly state: "error"; readonly onRetry: () => void }
  | { readonly state: "pending"; readonly count: number };

function message(props: SyncStripProps): string {
  switch (props.state) {
    case "offline":
      return "Offline. Your marks are saved.";
    case "rate-limited":
      return "Trakt is busy. Cue will retry shortly.";
    case "error":
      return "Trakt unreachable. Showing your cached data.";
    case "pending":
      return `${props.count} marks pending · will sync`;
  }
}

const STATE_TEST_ID: Partial<Record<SyncStripProps["state"], string>> = {
  offline: TEST_IDS.syncStripOffline,
  error: TEST_IDS.syncStripError,
};

/** Render first inside scroll content so the strip scrolls away. */
export function SyncStrip(props: SyncStripProps): ReactElement {
  const colors = useColors();
  const text = message(props);
  const liveRegion = useLiveRegion(text, "polite");
  const dot =
    props.state === "error"
      ? colors.danger
      : props.state === "offline"
        ? colors.muted
        : // --color-accent-ink rather than --color-accent: an 8 pt dot has no room
          // for the stroke an amber fill carries, and --color-accent is 1.83:1 on
          // the light --color-elevated it sits on.
          colors.accentInk;

  return (
    <View
      testID={TEST_IDS.syncStrip}
      {...liveRegion}
      style={[styles.strip, { backgroundColor: colors.elevated }]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <CueText
        testID={STATE_TEST_ID[props.state]}
        variant="meta"
        style={[styles.text, { color: colors.ink2 }]}
      >
        {text}
      </CueText>
      {props.state === "error" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={props.onRetry}
          style={styles.retry}
        >
          <CueText variant="meta" weight="semibold" style={{ color: colors.accentInk }}>
            Retry
          </CueText>
        </Pressable>
      ) : null}
    </View>
  );
}

const STRIP_HEIGHT = 32;

const styles = StyleSheet.create({
  strip: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    height: STRIP_HEIGHT,
    paddingHorizontal: SPACE.s4,
    marginHorizontal: -SPACE.s4,
  },
  dot: { flexShrink: 0, width: SPACE.s2, height: SPACE.s2, borderRadius: RADIUS.pill },
  text: { flex: 1, minWidth: 0 },
  // A 44 pt target inside a 32 pt band. The negative block margin is what lets
  // the target overflow the strip instead of the strip growing to hold it.
  retry: {
    flexShrink: 0,
    justifyContent: "center",
    minHeight: TARGET_MIN,
    marginVertical: (STRIP_HEIGHT - TARGET_MIN) / 2,
    paddingHorizontal: SPACE.s2,
    marginRight: -SPACE.s2,
  },
});
