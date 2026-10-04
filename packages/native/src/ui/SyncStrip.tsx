import type { SyncBanner } from "@cue/core/sync-contract";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLiveRegion } from "./live-region";
import { TEST_IDS } from "./test-ids";
import { RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

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
  if (kind === "offline" || kind === "retrying") return colors.muted;
  return colors.accentInk;
}

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
