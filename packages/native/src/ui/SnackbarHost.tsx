import {
  DEFAULT_SNACK_TIMEOUT_MS,
  dismissSnack,
  type Snack,
  useSnackbar,
} from "@cue/core/stores/snackbar-store";
import { type ReactElement, useEffect, useId, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenReader } from "../platform/screen-reader";
import { useLiveRegion } from "./live-region";
import { FLOAT_SHADOW, REFLOW_FONT_SCALE, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

/**
 * Where a host draws. `root` is the tab shell, whose snackbar has to clear the
 * floating tab bar as well as the bottom inset; `presentation` is anything
 * presented over it, which on iOS is a separate view controller a root-level
 * snackbar cannot draw into. The episode sheet is the first of those and the
 * account modal is the second.
 */
export type SnackbarPlacement = "root" | "presentation";

/**
 * How far a root-placed snackbar sits off the bottom edge. iOS 26 floats the tab
 * bar 40 pt off the screen edge and draws it 56 pt tall, and that 40 already
 * clears the bottom inset; Android's navigation bar is 80 dp drawn above the
 * gesture inset. Either way the snackbar clears the bar rather than only the
 * inset, so at a sheet's own bottom edge it lands in the same visual place.
 */
function rootBottom(insetBottom: number): number {
  return Platform.OS === "ios" ? 40 + 56 : insetBottom + 80;
}

/**
 * A screen reader has to finish reading the message and its actions before the
 * countdown is any use, so the window widens while one is on. Android's own
 * platform does this through `AccessibilityManager.getRecommendedTimeoutMillis`,
 * which React Native does not expose and which returns the original timeout
 * unless the user has set the accessibility timeout, so this is Cue's own rule.
 */
const SCREEN_READER_TIMEOUT_MS = 15_000;

/**
 * Which host is topmost. It is a rule rather than a list, because a list goes
 * stale the moment a presentation is added: the deepest host that is mounted is
 * the one drawing, and every host reads the same store, so dismissing a
 * presentation while a snack is up only moves which host draws it.
 */
let mounted: readonly string[] = [];
const listeners = new Set<() => void>();

function setMounted(next: readonly string[]): void {
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
  return mounted.at(-1) ?? null;
}

function useIsTopHost(): boolean {
  const id = useId();
  useEffect(() => {
    setMounted([...mounted, id]);
    return () => setMounted(mounted.filter((other) => other !== id));
  }, [id]);
  return useSyncExternalStore(subscribe, topHost) === id;
}

/**
 * The countdown, held outside the view. A presentation opening or closing
 * changes which host draws the snack, and re-hosting must not restart the
 * timer, so the deadline is keyed on the snack's own sequence number and only a
 * replacing snack sets a new one.
 */
let deadline: { readonly seq: number; readonly timeout: number; readonly at: number } | null = null;

/**
 * One transient message, mounted in every presentation that can raise one and
 * drawn only by the topmost. There is no close control and no hover pause: the
 * timer and the actions are the whole of it, and Undo is never the only way
 * back, so a missed snackbar is an inconvenience rather than a loss.
 */
export function SnackbarHost({
  placement,
}: {
  readonly placement: SnackbarPlacement;
}): ReactElement | null {
  const snack = useSnackbar((state) => state.snack);
  const isTopHost = useIsTopHost();

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
  const { fontScale } = useWindowDimensions();
  const screenReader = useScreenReader();
  // Every snack the app raises today carries a string; a richer message is read
  // by Android's live region and is what iOS's imperative announcement cannot take.
  const spoken = typeof snack.message === "string" ? snack.message : null;
  const liveRegion = useLiveRegion(spoken, "polite");

  useEffect(() => {
    const timeout = screenReader
      ? SCREEN_READER_TIMEOUT_MS
      : (snack.timeoutMs ?? DEFAULT_SNACK_TIMEOUT_MS);
    if (deadline?.seq !== snack.seq || deadline.timeout !== timeout) {
      deadline = { seq: snack.seq, timeout, at: Date.now() + timeout };
    }
    const timer = setTimeout(dismissSnack, Math.max(0, deadline.at - Date.now()));
    return () => clearTimeout(timer);
  }, [snack, screenReader]);

  const stacked = fontScale >= REFLOW_FONT_SCALE;
  const bottom = (placement === "root" ? rootBottom(insets.bottom) : insets.bottom) + SPACE.s2;

  return (
    <View
      testID="snackbar"
      {...liveRegion}
      style={[
        styles.snackbar,
        FLOAT_SHADOW,
        stacked && styles.stacked,
        { backgroundColor: colors.overlay, bottom },
      ]}
    >
      <CueText
        testID="snackbar-message"
        variant="rowTitle"
        style={[styles.message, !stacked && styles.messageInline, { color: colors.fg }]}
      >
        {snack.message}
      </CueText>
      <View style={styles.actions}>
        {(snack.actions ?? []).map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={action.testId}
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
  // At the largest content sizes the message and its actions stop sharing a
  // line rather than either of them shrinking below the target floor.
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
