import { resolveStill } from "@cue/core/data/image-source";
import { Image } from "expo-image";
import { type ReactElement, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const revealedStills = new Set<number>();
const SPOILER_BLUR_RADIUS = 24;
/** Below this the crop stops reading as a frame of the episode. */
const STILL_MIN_HEIGHT = 96;

/**
 * 16:9 when the sheet has the room for it, and the one thing that gives room
 * back when the sheet does not: the sheet cannot scroll, so a still at its full
 * height would push the mark row and the pager past the compact detent's edge.
 */
const widescreen = (height: number): ViewStyle => ({ flexBasis: height, maxHeight: height });

export function EpisodeStill({
  episodeId,
  stills,
  guarded,
}: {
  readonly episodeId: number;
  readonly stills: readonly string[];
  readonly guarded: boolean;
}): ReactElement | null {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [revealed, setRevealed] = useState(() => revealedStills.has(episodeId));
  const [failed, setFailed] = useState(false);
  const source = resolveStill(stills);
  if (source === null || failed) return null;
  const hidden = guarded && !revealed;
  return (
    <View style={[styles.still, widescreen((width - SPACE.s4 * 2) * (9 / 16))]}>
      <Image
        testID={hidden ? TEST_IDS.episodeStillBlur : undefined}
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={hidden ? SPOILER_BLUR_RADIUS : 0}
        onError={() => setFailed(true)}
      />
      {hidden && (
        <Pressable
          testID={TEST_IDS.episodeStillReveal}
          accessibilityRole="button"
          accessibilityLabel="Reveal episode still"
          style={styles.reveal}
          onPress={() => {
            revealedStills.add(episodeId);
            setRevealed(true);
          }}
        >
          <View style={[styles.chip, { backgroundColor: colors.scrim }]}>
            <CueText variant="rowTitleSecondary" style={{ color: colors.onImage }}>
              Tap to reveal
            </CueText>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  still: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: STILL_MIN_HEIGHT,
    width: "100%",
    borderRadius: RADIUS.poster,
    overflow: "hidden",
  },
  reveal: { flex: 1, justifyContent: "center", alignItems: "center" },
  chip: { borderRadius: RADIUS.pill, padding: SPACE.s4 },
});
