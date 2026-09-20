import { useHaptics } from "@cue/core/ports/haptics";
import { type PrefsStore, type Theme, usePrefs } from "@cue/core/prefs/prefs-store";
import { type ReactElement, useLayoutEffect, useSyncExternalStore } from "react";
import { Appearance, Pressable, View } from "react-native";
import { TEST_IDS } from "../../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const OPTIONS: readonly { value: Theme; label: string; testID: string }[] = [
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
  const colors = useColors();
  const haptics = useHaptics();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        backgroundColor: colors.elevated,
        borderRadius: RADIUS.control,
      }}
    >
      {OPTIONS.map((option) => (
        <Pressable
          key={option.value}
          testID={option.testID}
          accessibilityRole="radio"
          accessibilityLabel={`${option.label} theme`}
          accessibilityState={{ checked: theme === option.value }}
          onPress={() => {
            haptics.selection();
            setTheme(option.value);
          }}
          style={{
            minHeight: TARGET_MIN,
            paddingHorizontal: SPACE.s2,
            justifyContent: "center",
            borderRadius: RADIUS.control,
            borderWidth: HAIRLINE,
            borderColor: theme === option.value ? colors.muted : "transparent",
            backgroundColor: theme === option.value ? colors.overlay : "transparent",
          }}
        >
          <CueText variant="meta" style={{ color: colors.fg }}>
            {option.label}
          </CueText>
        </Pressable>
      ))}
    </View>
  );
}
