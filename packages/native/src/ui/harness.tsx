import { type ReactElement, useLayoutEffect, useRef } from "react";
import { Platform } from "react-native";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";
import { commitResponseTiming, useResponseTiming } from "./response-timing";
import { useSnackbarTrace } from "./snackbar-trace";

export { AppIdle, useAppIdleStamp } from "./AppIdle";
export { beginResponseTiming } from "./response-timing";

export const HIDE_CARET = Platform.OS === "android";

export function ResponseTimingMarker(): ReactElement | null {
  const label = useResponseTiming();
  return label === null ? null : (
    <Marker accessibilityLabel={label} testID={HARNESS_IDS.responseTiming} />
  );
}

export function SnackbarTrace(): ReactElement | null {
  const label = useSnackbarTrace();
  return label === null ? null : (
    <Marker accessibilityLabel={label} testID={HARNESS_IDS.snackbarTrace} />
  );
}

export function useQueueResponseTiming(queue: unknown): void {
  const timed = useRef(queue);
  useLayoutEffect(() => {
    if (timed.current === queue) return;
    timed.current = queue;
    commitResponseTiming();
  }, [queue]);
}
