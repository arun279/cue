import type { ReactElement } from "react";
import { Platform } from "react-native";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";
import { usePressTrace } from "./press-trace";
import { useSnackbarTrace } from "./snackbar-trace";

export { AppIdle } from "./AppIdle";
export { tracePress } from "./press-trace";

export const HIDE_CARET = Platform.OS === "android";

export function SnackbarTrace(): ReactElement | null {
  const label = useSnackbarTrace();
  return label === null ? null : (
    <Marker accessibilityLabel={label} testID={HARNESS_IDS.snackbarTrace} />
  );
}

export function PressTrace(): ReactElement | null {
  const label = usePressTrace();
  return label === null ? null : (
    <Marker accessibilityLabel={label} testID={HARNESS_IDS.pressTrace} />
  );
}
