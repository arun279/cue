import { type PrefsStore, type Theme, usePrefs } from "@cue/core/prefs/prefs-store";
import { type ReactElement, useLayoutEffect, useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import { SegmentedControl, type SegmentOption } from "../../ui/SegmentedControl";
import { TEST_IDS } from "../../ui/test-ids";

const OPTIONS: readonly SegmentOption<Theme>[] = [
  { value: "system", label: "System", testID: TEST_IDS.themeSystem },
  { value: "dark", label: "Dark", testID: TEST_IDS.themeDark },
  { value: "light", label: "Light", testID: TEST_IDS.themeLight },
];

export function useAppearance(store: PrefsStore): void {
  const theme = useSyncExternalStore(store.subscribe, () => store.getState().theme);
  useLayoutEffect(
    () => Appearance.setColorScheme(theme === "system" ? "unspecified" : theme),
    [theme],
  );
}

export function ThemeControl(): ReactElement {
  const theme = usePrefs((state) => state.theme);
  const setTheme = usePrefs((state) => state.setTheme);
  return <SegmentedControl segments={OPTIONS} value={theme} onChange={setTheme} />;
}
