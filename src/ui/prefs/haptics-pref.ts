const STORAGE_KEY = "cue.haptics-enabled";

/**
 * The device-local "Haptics" preference. Default ON — the one
 * buzz on a mark/undo is the point-of-action confirmation; a user who dislikes it
 * turns it off in Settings. Absent (fresh device / web) reads as ON; only an
 * explicit "0" disables. Never Trakt-synced.
 */
export function initialHapticsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // A restricted-storage failure just forgets the choice next visit — non-fatal.
  }
}
