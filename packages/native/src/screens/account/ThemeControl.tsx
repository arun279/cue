import { useHaptics } from "@cue/core/ports/haptics";
import { type PrefsStore, type Theme, usePrefs } from "@cue/core/prefs/prefs-store";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { type ReactElement, useLayoutEffect, useSyncExternalStore } from "react";
import { Appearance } from "react-native";

const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
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
  const haptics = useHaptics();
  return (
    <SegmentedControl
      values={OPTIONS.map((option) => option.label)}
      selectedIndex={OPTIONS.findIndex((option) => option.value === theme)}
      onChange={({ nativeEvent }) => {
        haptics.selection();
        const option = OPTIONS[nativeEvent.selectedSegmentIndex];
        if (option) setTheme(option.value);
      }}
    />
  );
}
