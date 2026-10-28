import type { NativeStackNavigationOptions } from "expo-router";

export const PRESENTATIONS = {
  "(account)": "fullScreenModal",
  "history-jump": "formSheet",
  "show/[showId]/episode/[season]/[episode]": "formSheet",
} as const satisfies Record<string, NativeStackNavigationOptions["presentation"]>;

export const isPresented = (name: string): boolean => Object.hasOwn(PRESENTATIONS, name);
