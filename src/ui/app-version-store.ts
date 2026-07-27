import { create } from "zustand";
import { version } from "../../package.json";

interface AppVersionState {
  /** The version identity rendered in Settings. */
  appVersion: string;
  setAppVersion(version: string): void;
}

/** Tiny cross-tree client state: the Settings app version's single source. */
export const useAppVersionStore = create<AppVersionState>((set) => ({
  appVersion: version,
  setAppVersion: (appVersion) => set({ appVersion }),
}));
