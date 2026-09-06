import { booleanPref } from "@cue/core/prefs/pref-storage";
import { preferenceStorage } from "@ui/prefs/preference-storage";
import type { ReactElement } from "react";

const dismissedPref = booleanPref(preferenceStorage, "cue.tutorial-mark-dismissed", false);

/** True once the one-time caption has been dismissed (by the first-ever mark). */
export const initialTutorialDismissed = dismissedPref.initial;

export const persistTutorialDismissed = (): void => dismissedPref.persist(true);

/**
 * The entire tutorial: one quiet first-session caption under the first queue
 * row's check. It dismisses permanently on the first mark; the action teaches
 * itself from then on.
 */
export function TutorialCaption(): ReactElement {
  return (
    <p className="tutorial-caption" data-testid="tutorial-caption">
      Tap to mark watched. Undo appears below.
    </p>
  );
}
