/**
 * The Capacitor build's own key-value store, read-only apart from the one key
 * the migration is allowed to take away.
 *
 * A port rather than a direct read because the two platforms do not agree on
 * the key shape: Capacitor Preferences prefixes its group onto the key on iOS
 * (`CapacitorStorage.cue.trakt.token` in `UserDefaults`) and uses the group as
 * the file name on Android (`cue.trakt.token` inside `CapacitorStorage`
 * shared preferences). The implementation owns that difference so the migration
 * can be a pure function of what it reads back.
 *
 * Only the native app provides one. The web app is the Capacitor build.
 */
export interface LegacyStore {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}
