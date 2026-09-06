import { useAuth } from "@cue/core/auth/store";
import { useAppVersion } from "@cue/core/ports/app-version";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import type { ReactElement } from "react";
import { Pressable, Switch, Text, View } from "react-native";

/** Settings: the device-local preferences, the app identity, and sign-out. */
export function Settings(): ReactElement {
  const hapticsEnabled = usePrefs((s) => s.hapticsEnabled);
  const setHapticsEnabled = usePrefs((s) => s.setHapticsEnabled);
  const version = useAppVersion();
  const disconnect = useAuth((s) => s.disconnect);

  return (
    <View testID="screen-settings">
      <Text accessibilityRole="header">Settings</Text>
      <View>
        <Text>Haptics</Text>
        <Switch
          testID="settings-haptics"
          accessibilityLabel="Haptics"
          value={hapticsEnabled}
          onValueChange={setHapticsEnabled}
        />
      </View>
      <Text testID="settings-version">{version}</Text>
      <Pressable
        accessibilityRole="button"
        testID="settings-disconnect"
        onPress={() => void disconnect()}
      >
        <Text>Disconnect</Text>
      </Pressable>
    </View>
  );
}
