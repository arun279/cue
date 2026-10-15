import { type ReactElement, useRef, useState } from "react";
import { Platform, type ScrollViewProps } from "react-native";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";
import { usePressTrace } from "./press-trace";
import { useSnackbarTrace } from "./snackbar-trace";

export { AppIdle, trackSync } from "./AppIdle";
export { tracePress } from "./press-trace";

export const HIDE_CARET = Platform.OS === "android";

export function useScrollAcknowledgment(): {
  handlers: ScrollViewProps;
  marker: ReactElement | null;
} {
  const generation = useRef(0);
  const momentum = useRef(0);
  const [started, setStarted] = useState(0);
  const [completed, setCompleted] = useState("; scroll 0 done;");
  const finish = (id: number): void => {
    const receipt = ` scroll ${id} done;`;
    setCompleted((previous) => (previous.includes(receipt) ? previous : previous + receipt));
  };
  return {
    handlers: {
      onScrollBeginDrag: () => setStarted(++generation.current),
      onScrollEndDrag: ({ nativeEvent }) => {
        if (
          Platform.OS === "ios" &&
          nativeEvent.velocity?.y === 0 &&
          nativeEvent.targetContentOffset?.y === nativeEvent.contentOffset.y
        )
          finish(generation.current);
      },
      onMomentumScrollBegin: () => {
        momentum.current = generation.current;
      },
      onMomentumScrollEnd: () => finish(momentum.current),
    },
    marker: (
      <>
        <Marker testID={HARNESS_IDS.scrollStarted} accessibilityLabel={String(started)} />
        <Marker testID={HARNESS_IDS.scrollCompleted} accessibilityLabel={completed} />
      </>
    ),
  };
}

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
