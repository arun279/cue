import type { SyncBanner } from "@cue/core/sync-contract";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLiveRegion } from "./live-region";
import { TEST_IDS } from "./test-ids";
import { RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

/**
 * Ambient sync state, drawn from the contract's own line so a screen cannot
 * invent a message and the two apps cannot drift apart on what a rate limit is
 * called. Healthy is silence, so it is not a state here: the caller renders
 * nothing at all and no space is held for a strip.
 *
 * The dot is a locator rather than the message. Every state has its own
 * sentence, which is WCAG 1.4.1, and the dot never carries one alone.
 */
export interface SyncStripProps {
  readonly banner: SyncBanner;
  readonly onRetry: () => void;
}

const STATE_TEST_ID: Partial<Record<SyncBanner["kind"], string>> = {
  offline: TEST_IDS.syncStripOffline,
  unreachable: TEST_IDS.syncStripError,
};

function dotOf(kind: SyncBanner["kind"], colors: ReturnType<typeof useColors>) {
  if (kind === "unreachable") return colors.danger;
  // Offline and retrying have no failure to blame and nothing to retry.
  if (kind === "offline" || kind === "retrying") return colors.muted;
  // --color-accent-ink rather than --color-accent: an 8 pt dot has no room for
  // the stroke an amber fill carries, and --color-accent is 1.83:1 on the light
  // --color-elevated it sits on.
  return colors.accentInk;
}

/** Render first inside scroll content so the strip scrolls away. */
export function SyncStrip({ banner, onRetry }: SyncStripProps): ReactElement {
  const colors = useColors();
  const liveRegion = useLiveRegion(banner.message, "polite");

  return (
    <View
      testID={TEST_IDS.syncStrip}
      {...liveRegion}
      style={[styles.strip, { backgroundColor: colors.elevated }]}
    >
      <View style={[styles.dot, { backgroundColor: dotOf(banner.kind, colors) }]} />
      <CueText
        testID={STATE_TEST_ID[banner.kind]}
        variant="meta"
        style={[styles.text, { color: colors.ink2 }]}
      >
        {banner.message}
      </CueText>
      {banner.retryable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={onRetry}
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
  // A band rather than a box: the longest line the contract ships ("Trakt is
  // having trouble. Showing your cached data.") does not fit beside a Retry on a
  // 390 pt screen, and a strip that truncates keeps the alarm and cuts the
  // reassurance. The strip is in flow, so it can grow instead.
  strip: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    minHeight: STRIP_HEIGHT,
    paddingHorizontal: SPACE.s4,
    marginHorizontal: -SPACE.s4,
  },
  dot: { flexShrink: 0, width: SPACE.s2, height: SPACE.s2, borderRadius: RADIUS.pill },
  text: { flex: 1, minWidth: 0, paddingVertical: SPACE.s1 },
  // A 44 pt target beside a band that is 32 pt when its line is short. The
  // negative block margin lets the target overflow a short band rather than
  // making every strip 44 pt tall.
  retry: {
    flexShrink: 0,
    alignSelf: "center",
    justifyContent: "center",
    minHeight: TARGET_MIN,
    marginVertical: (STRIP_HEIGHT - TARGET_MIN) / 2,
    paddingHorizontal: SPACE.s2,
    marginRight: -SPACE.s2,
  },
});
