import { type ReactElement, useEffect, useId, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DEFAULT_SNACK_TIMEOUT_MS,
  type Snack,
  setSnackbarTimeout,
  snackText,
  useSnackbar,
} from "@/core/stores/snackbar-store";
import { useScreenReader } from "../platform/screen-reader";
import { useLiveRegion } from "./live-region";
import { TEST_IDS } from "./test-ids";
import {
  FLOAT_SHADOW,
  SPACE,
  sheetBottomInset,
  TARGET_MIN,
  tabBarClearance,
  useColors,
  useStacked,
} from "./tokens";
import { CueText } from "./type";

export type SnackbarPlacement = "root" | "presentation" | "sheet";

const LONG_TIMEOUT_MS = 15_000;

let mounted: readonly { readonly id: string; readonly placement: SnackbarPlacement }[] = [];
const listeners = new Set<() => void>();

function setMounted(next: typeof mounted): void {
  mounted = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function topHost(): string | null {
  return (mounted.findLast((host) => host.placement !== "root") ?? mounted.at(-1))?.id ?? null;
}

function useIsTopHost(placement: SnackbarPlacement): boolean {
  const id = useId();
  useEffect(() => {
    setMounted([...mounted, { id, placement }]);
    return () => setMounted(mounted.filter((other) => other.id !== id));
  }, [id, placement]);
  return useSyncExternalStore(subscribe, topHost) === id;
}

export function SnackbarHost({
  placement,
}: {
  readonly placement: SnackbarPlacement;
}): ReactElement | null {
  const snack = useSnackbar((state) => state.snack);
  const isTopHost = useIsTopHost(placement);

  if (snack === null || !isTopHost) return null;
  return <Snackbar snack={snack} placement={placement} />;
}

function Snackbar({
  snack,
  placement,
}: {
  readonly snack: Snack;
  readonly placement: SnackbarPlacement;
}): ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const holdLong = useScreenReader();
  const liveRegion = useLiveRegion(snackText(snack.message), "polite");

  useEffect(() => {
    setSnackbarTimeout(holdLong ? LONG_TIMEOUT_MS : (snack.timeoutMs ?? DEFAULT_SNACK_TIMEOUT_MS));
  }, [snack, holdLong]);

  const stacked = useStacked();
  const bottom = edgeClearance(placement, insets.bottom) + SPACE.s2;

  return (
    <View
      testID={TEST_IDS.snackbar}
      {...liveRegion}
      style={[
        styles.snackbar,
        FLOAT_SHADOW,
        stacked && styles.stacked,
        { backgroundColor: colors.overlay, bottom },
      ]}
    >
      <CueText
        testID={TEST_IDS.snackbarMessage}
        variant="rowTitle"
        style={[styles.message, !stacked && styles.messageInline, { color: colors.fg }]}
      >
        {typeof snack.message === "string" ? (
          snack.message
        ) : (
          <>
            <CueText variant="rowTitle" weight="bold">
              {snack.message.subject}
            </CueText>
            {snack.message.predicate}
          </>
        )}
      </CueText>
      <View style={styles.actions}>
        {(snack.actions ?? []).map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={action.label === "Undo" ? TEST_IDS.snackbarUndo : action.testId}
            onPress={action.onPress}
            style={styles.action}
          >
            <CueText variant="rowTitle" weight="semibold" style={{ color: colors.accentInk }}>
              {action.label}
            </CueText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function edgeClearance(placement: SnackbarPlacement, insetBottom: number): number {
  if (placement === "root") return tabBarClearance(insetBottom);
  return placement === "sheet" ? sheetBottomInset(insetBottom) : insetBottom;
}

const styles = StyleSheet.create({
  snackbar: {
    position: "absolute",
    left: SPACE.s3,
    right: SPACE.s3,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    paddingLeft: 14,
    paddingRight: SPACE.s1 + 2,
    paddingVertical: SPACE.s1 + 2,
    borderRadius: 14,
  },
  stacked: { flexDirection: "column", alignItems: "stretch", gap: SPACE.s2 },
  message: { minWidth: 0 },
  messageInline: { flex: 1 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: SPACE.s2,
  },
  action: {
    minWidth: TARGET_MIN,
    minHeight: TARGET_MIN,
    paddingHorizontal: SPACE.s3 - 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
