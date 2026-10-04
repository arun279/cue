import { usePrefs } from "../prefs/prefs-store";
import { showUndoable } from "../stores/snackbar-store";

export interface AlertsMute {
  readonly label: string;
  toggle(): void;
}

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
