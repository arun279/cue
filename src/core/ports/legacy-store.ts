// Capacitor Preferences keys are CapacitorStorage.<key> in iOS UserDefaults and <key> in the Android CapacitorStorage file.
// clearWebView deletes everything but cookies from the web view Cue 1.0 ran in.
export interface LegacyStore {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  clearWebView(): Promise<void>;
}
