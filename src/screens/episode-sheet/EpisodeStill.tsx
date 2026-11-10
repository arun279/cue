import { Image } from "expo-image";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { resolveStill } from "@/core/domain/image-source";
import { useRevealedStills } from "@/core/stores/revealed-stills-store";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { useImageUrl } from "../../ui/useImageUrl";

const SPOILER_BLUR_RADIUS = 24;
const STILL_MIN_HEIGHT = 96;

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
  const revealed = useRevealedStills(({ episodeIds }) => episodeIds.has(episodeId));
  const [source, onError] = useImageUrl(resolveStill(stills));
  if (source === null) return null;
  const hidden = guarded && !revealed;
  return (
    <View style={[styles.still, widescreen((width - SPACE.s4 * 2) * (9 / 16))]}>
      <Image
        testID={hidden ? TEST_IDS.episodeStillBlur : undefined}
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={hidden ? SPOILER_BLUR_RADIUS : 0}
        onError={onError}
      />
      {hidden && (
        <Pressable
          testID={TEST_IDS.episodeStillReveal}
          accessibilityRole="button"
          accessibilityLabel="Reveal episode still"
          style={styles.reveal}
          onPress={() =>
            useRevealedStills.setState(({ episodeIds }) => ({
              episodeIds: new Set(episodeIds).add(episodeId),
            }))
          }
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
