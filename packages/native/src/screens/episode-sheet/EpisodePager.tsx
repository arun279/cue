import { type EpisodeKey, epCode } from "@cue/core/domain/model/library";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Chevron } from "../../ui/Chevron";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function EpisodePager({
  showId,
  prev,
  next,
}: {
  readonly showId: number;
  readonly prev: EpisodeKey | null;
  readonly next: EpisodeKey | null;
}): ReactElement {
  const router = useRouter();
  const colors = useColors();
  return (
    <View style={styles.pager}>
      {[
        { episode: prev, forward: false },
        { episode: next, forward: true },
      ].map(({ episode, forward }) => (
        <Pressable
          key={String(forward)}
          testID={forward ? TEST_IDS.episodePagerNext : undefined}
          accessibilityRole="button"
          accessibilityLabel={
            episode === null
              ? `No ${forward ? "later" : "earlier"} episode`
              : epCode(episode.season, episode.number)
          }
          accessibilityState={{ disabled: episode === null }}
          disabled={episode === null}
          style={styles.button}
          onPress={() => {
            if (episode !== null)
              router.replace(`/show/${showId}/episode/${episode.season}/${episode.number}`);
          }}
        >
          {!forward && <Chevron direction="back" />}
          {episode !== null && (
            <CueText variant="meta" style={{ color: colors.accentInk }}>
              {epCode(episode.season, episode.number)}
            </CueText>
          )}
          {forward && <Chevron direction="forward" />}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pager: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: SPACE.s2,
    paddingTop: SPACE.s4,
  },
  button: {
    minHeight: TARGET_MIN,
    minWidth: TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
  },
});
