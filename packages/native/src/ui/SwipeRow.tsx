import { type Haptics, useHaptics } from "@cue/core/ports/haptics";
import { type ReactElement, type ReactNode, useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Swipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { runOnJS, type SharedValue, useAnimatedReaction } from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { SPACE, SWIPE_COMMIT, useColors } from "./tokens";
import { CueText } from "./type";

const REVEAL_BLEED = 240;
const GLYPH_REST = 20;
const GLYPH_ARMED = 24;

type Side = "mark" | "stop";

export interface SwipeRowProps {
  readonly onMark?: () => void;
  readonly onStop: () => void;
  readonly testID?: string;
  readonly children: ReactNode;
}

export function SwipeRow({ onMark, onStop, testID, children }: SwipeRowProps): ReactElement {
  const haptics = useHaptics();
  const row = useRef<SwipeableMethods>(null);

  const commit = (direction: SwipeDirection): void => {
    row.current?.close();
    // The library reports the finger's direction: a right drag opens the LEFT panel and reports RIGHT.
    if (direction === SwipeDirection.RIGHT) onMark?.();
    else onStop();
  };

  return (
    <Swipeable
      ref={row}
      testID={testID}
      leftThreshold={SWIPE_COMMIT}
      rightThreshold={SWIPE_COMMIT}
      onSwipeableOpenStartDrag={haptics.prepare}
      onSwipeableWillOpen={commit}
      renderLeftActions={
        onMark === undefined
          ? undefined
          : (_progress, translation) => (
              <Reveal side="mark" translation={translation} haptics={haptics} />
            )
      }
      renderRightActions={(_progress, translation) => (
        <Reveal side="stop" translation={translation} haptics={haptics} />
      )}
    >
      {children}
    </Swipeable>
  );
}

function Reveal({
  side,
  translation,
  haptics,
}: {
  readonly side: Side;
  readonly translation: SharedValue<number>;
  readonly haptics: Haptics;
}): ReactElement {
  const colors = useColors();
  const [armed, setArmed] = useState(false);
  const mark = side === "mark";

  const cross = useCallback(
    (past: boolean) => {
      setArmed(past);
      if (past) haptics.thresholdActivate();
      else haptics.thresholdDeactivate();
    },
    [haptics],
  );

  useAnimatedReaction(
    () => (mark ? translation.value >= SWIPE_COMMIT : translation.value <= -SWIPE_COMMIT),
    (past, previous) => {
      if (past === (previous ?? false)) return;
      runOnJS(cross)(past);
    },
  );

  const ink = armed ? (mark ? colors.watchedFg : colors.fg) : colors.muted;
  const size = armed ? GLYPH_ARMED : GLYPH_REST;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.strip}
    >
      <View
        style={[
          styles.fill,
          mark ? styles.fillLeading : styles.fillTrailing,
          { backgroundColor: armed && mark ? colors.watched : colors.elevated },
        ]}
      />
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {mark ? (
          <Path
            d="M4 12.5 9.5 18 20 6.5"
            fill="none"
            stroke={ink}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <Rect x="5" y="4" width="14" height="16" rx="3" fill={ink} />
        )}
      </Svg>
      {armed ? (
        <CueText variant="micro" weight="bold" eyebrow style={{ color: ink }}>
          {mark ? "Watched" : "Stop"}
        </CueText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { width: SWIPE_COMMIT, alignItems: "center", justifyContent: "center", gap: SPACE.s1 },
  fill: { position: "absolute", top: 0, bottom: 0 },
  fillLeading: { left: 0, right: -REVEAL_BLEED },
  fillTrailing: { right: 0, left: -REVEAL_BLEED },
});
