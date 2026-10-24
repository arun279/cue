// Capacitor Preferences keys are CapacitorStorage.<key> in iOS UserDefaults and <key> in the Android CapacitorStorage file.
export interface LegacyStore {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}
