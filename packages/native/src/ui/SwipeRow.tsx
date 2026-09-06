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

/**
 * How far the reveal's fill runs past its own strip. The strip is the commit
 * distance wide, because that is where the row rests once it opens, but the drag
 * overshoots past it, and without the bleed the overshoot draws a gap between
 * the fill and the row traveling over it.
 */
const REVEAL_BLEED = 240;
const GLYPH_REST = 20;
const GLYPH_ARMED = 24;

type Side = "mark" | "stop";

export interface SwipeRowProps {
  /** Commit a right swipe. Omit to disable the direction, which is what an
   * already-marked row does: there is nothing left to mark. */
  readonly onMark?: () => void;
  readonly onStop: () => void;
  readonly testID?: string;
  readonly children: ReactNode;
}

/**
 * The swipe accelerator on a queue row: right marks, left stops, each committing
 * through the same handler its visible tap target uses, so the gesture is never
 * the only path (WCAG 2.5.1) and the wrapper itself carries no semantics.
 *
 * The threshold is visual first. `prepare()` warms the feedback engine when the
 * drag starts, but the arming still has to be legible before it is felt, so the
 * reveal changes fill, glyph and label off the drag's own translation rather
 * than announcing the threshold by haptic alone.
 */
export function SwipeRow({ onMark, onStop, testID, children }: SwipeRowProps): ReactElement {
  const haptics = useHaptics();
  const row = useRef<SwipeableMethods>(null);

  const commit = (direction: SwipeDirection): void => {
    row.current?.close();
    // The library names the direction the finger traveled: dragging right opens
    // the LEFT panel and reports RIGHT. Reading that inversion the other way
    // stops a show the reader meant to mark.
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

/**
 * The revealed strip, running full bleed to the screen edge with its glyph and
 * label centred in it. Crossing the threshold is a handful of discrete events in
 * a whole gesture rather than a per-frame animation, so it lands on the JS
 * thread beside the haptic it has to stay in step with.
 */
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
    // Each reveal watches its own direction. Reading the magnitude instead would
    // arm both of them on one drag and tick twice.
    () => (mark ? translation.value >= SWIPE_COMMIT : translation.value <= -SWIPE_COMMIT),
    (past, previous) => {
      // No previous reading means the row is at rest, so the first look at an
      // unarmed row is not a crossing and must not tick.
      if (past === (previous ?? false)) return;
      runOnJS(cross)(past);
    },
  );

  // Stop takes no danger tint: it is deliberate, it is reversible from the
  // snackbar, and its words carry the consequence, which is WCAG 1.4.1.
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
