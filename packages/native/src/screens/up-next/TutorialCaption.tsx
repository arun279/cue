import { booleanPref } from "@cue/core/prefs/pref-storage";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { preferenceStorage } from "../../platform/stores";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const dismissed = booleanPref(preferenceStorage, "cue.tutorial-mark-dismissed", false);

export const initialTutorialDismissed = dismissed.initial;

export const persistTutorialDismissed = (): void => dismissed.persist(true);

export function TutorialCaption(): ReactElement {
  const colors = useColors();

  return (
    <CueText
      testID={TEST_IDS.tutorialCaption}
      variant="meta"
      style={[styles.caption, { color: colors.muted }]}
    >
      Tap to mark watched. Undo appears below.
    </CueText>
  );
}

const styles = StyleSheet.create({
  caption: { textAlign: "right", paddingHorizontal: SPACE.s4, paddingBottom: SPACE.s2 },
});
