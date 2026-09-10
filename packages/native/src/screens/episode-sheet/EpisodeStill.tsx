import { resolveStill } from "@cue/core/data/image-source";
import { Image } from "expo-image";
import { type ReactElement, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const revealedStills = new Set<number>();
const SPOILER_BLUR_RADIUS = 24;

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
  const [revealed, setRevealed] = useState(() => revealedStills.has(episodeId));
  const [failed, setFailed] = useState(false);
  const source = resolveStill(stills);
  if (source === null || failed) return null;
  const hidden = guarded && !revealed;
  return (
    <View style={styles.still}>
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
  still: { aspectRatio: 16 / 9, width: "100%", borderRadius: RADIUS.poster, overflow: "hidden" },
  reveal: { flex: 1, justifyContent: "center", alignItems: "center" },
  chip: { borderRadius: RADIUS.pill, padding: SPACE.s4 },
});
