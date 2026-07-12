import type { ReactElement } from "react";

const STORAGE_KEY = "cue.tutorial-mark-dismissed";

/** True once the one-time caption has been dismissed (by the first-ever mark). */
export function initialTutorialDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function persistTutorialDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // A restricted-storage failure re-shows the caption next visit: harmless.
  }
}

/**
 * The entire tutorial: one quiet first-session caption under the first queue
 * row's check. It dismisses permanently on the first mark — the action teaches
 * itself from then on.
 */
export function TutorialCaption(): ReactElement {
  return (
    <p className="tutorial-caption" data-testid="tutorial-caption">
      Tap to mark watched — Undo appears below.
    </p>
  );
}
