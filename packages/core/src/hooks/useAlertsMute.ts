import { usePrefs } from "../prefs/prefs-store";
import { showUndoable } from "../stores/snackbar-store";

export interface AlertsMute {
  /** The menu item's label, which is also the only place the state shows. */
  readonly label: string;
  toggle(): void;
}

/** One show's new-episode alerts, muted and unmuted on this device alone. */
export function useAlertsMute(showId: number, title: string): AlertsMute {
  const muted = usePrefs((state) => state.mutedShowIds.includes(showId));
  const setShowMuted = usePrefs((state) => state.setShowMuted);
  return {
    label: muted ? "Unmute episode alerts" : "Mute episode alerts",
    toggle: () => {
      setShowMuted(showId, !muted);
      if (!muted) {
        showUndoable(`Episode alerts muted for ${title}.`, () => setShowMuted(showId, false));
      }
    },
  };
}
