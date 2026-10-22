import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import {
  type NativeStackNavigationProp,
  useNavigation,
  useNavigationContainerRef,
} from "expo-router";
import type { NavigationContainerRef, ParamListBase } from "expo-router/react-navigation";
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  type ScrollViewProps,
  View,
  type ViewProps,
} from "react-native";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";
import { usePressTrace } from "./press-trace";
import { useSnackbarTrace } from "./snackbar-trace";

export { AppIdle, trackSync } from "./AppIdle";
export { usePerfCommand, usePerfScroll } from "./perf-channel";
export { tracePress } from "./press-trace";

const launchedAt = Date.now();

export const relativeTimeNow = (): number => launchedAt;

export function SnackbarRouteDismissal(): null {
  const navigation: NavigationContainerRef<ParamListBase> = useNavigationContainerRef();
  useEffect(() => {
    let previous = navigation.getCurrentRoute()?.key;
    return navigation.addListener("state", () => {
      const current = navigation.getCurrentRoute()?.key;
      if (
        previous !== current &&
        useSnackbar.getState().snack?.actions?.some((action) => action.testId === "snackbar-undo")
      )
        dismissSnack();
      previous = current;
    });
  }, [navigation]);
  return null;
}

export const HIDE_CARET = Platform.OS === "android";

export function useOnboardingAcknowledgment(): {
  onLayout: ViewProps["onLayout"];
  marker: ReactElement | null;
} {
  const [laidOut, setLaidOut] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!laidOut) return;
    const idle = requestIdleCallback(() => setReady(true));
    return () => cancelIdleCallback(idle);
  }, [laidOut]);
  return {
    onLayout: () => setLaidOut(true),
    marker: ready ? <Marker testID={HARNESS_IDS.onboardingReady} /> : null,
  };
}

export function SheetPresented(): ReactElement | null {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const [presented, setPresented] = useState(false);
  useLayoutEffect(
    () =>
      navigation.addListener("transitionEnd", ({ data }) => {
        if (!data.closing) setPresented(true);
      }),
    [navigation],
  );
  return presented ? (
    <View
      testID={HARNESS_IDS.sheetPresented}
      pointerEvents="none"
      style={{ position: "absolute", top: 8, left: "50%", width: 1, height: 1 }}
    />
  ) : null;
}

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
        const { velocity, contentOffset, targetContentOffset } = nativeEvent;
        setCompleted(
          (previous) =>
            `${previous} drag ${generation.current} ended at ${contentOffset.y} toward ${targetContentOffset?.y} at ${velocity?.y};`,
        );
        const restsWhereItEnded = targetContentOffset?.y === contentOffset.y;
        if (Platform.OS === "ios" && restsWhereItEnded) finish(generation.current);
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
  return <Marker accessibilityLabel={label} testID={HARNESS_IDS.pressTrace} />;
}

const pullEntry = (entry: string, since: number): string =>
  `${entry} +${Math.round(performance.now() - since)}; `;

const offsetOf = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>): string =>
  `y ${Math.round(nativeEvent.contentOffset.y)}`;

export function usePullTrace(refreshing: boolean): {
  handlers: ScrollViewProps;
  marker: ReactElement | null;
} {
  const shownAt = useRef(performance.now());
  const [trace, setTrace] = useState("");
  useEffect(() => {
    setTrace((previous) => previous + pullEntry(`refreshing ${refreshing}`, shownAt.current));
  }, [refreshing]);
  const note = (entry: string): void =>
    setTrace((previous) => previous + pullEntry(entry, shownAt.current));
  return {
    handlers: {
      onScrollBeginDrag: (event) => note(`drag ${offsetOf(event)}`),
      onScrollEndDrag: (event) => note(`release ${offsetOf(event)}`),
    },
    marker: <Marker testID={HARNESS_IDS.pullTrace} accessibilityLabel={trace} />,
  };
}
