import { booleanPref } from "@cue/core/prefs/pref-storage";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { preferenceStorage } from "../../platform/stores";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const dismissed = booleanPref(preferenceStorage, "cue.tutorial-mark-dismissed", false);

/** True once the one-time caption has been dismissed, by the first-ever mark. */
export const initialTutorialDismissed = dismissed.initial;

export const persistTutorialDismissed = (): void => dismissed.persist(true);

/**
 * The entire tutorial: one quiet first-session line under the first queue row's
 * check, aligned to the control it is about. It dies permanently on the first
 * mark from any row, and there is no dismiss control, because a control would be
 * a second thing to learn. It teaches the app's one core action in its
 * gesture-free form, which is the form every reader can reach; the two swipes
 * are accelerators and are never taught by a caption.
 */
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
