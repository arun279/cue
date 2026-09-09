import { useAuth } from "@cue/core/auth/store";
import { useAppVersion } from "@cue/core/ports/app-version";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import type { ReactElement } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { TEST_IDS } from "../../src/ui/test-ids";

/** Settings: the device-local preferences, the app identity, and sign-out. */
export default function Settings(): ReactElement {
  const hapticsEnabled = usePrefs((s) => s.hapticsEnabled);
  const setHapticsEnabled = usePrefs((s) => s.setHapticsEnabled);
  const version = useAppVersion();
  const disconnect = useAuth((s) => s.disconnect);

  return (
    <View testID={TEST_IDS.screenSettings}>
      <Text accessibilityRole="header">Settings</Text>
      <View>
        <Text>Haptics</Text>
        <Switch
          testID={TEST_IDS.settingsHaptics}
          accessibilityLabel="Haptics"
          value={hapticsEnabled}
          onValueChange={setHapticsEnabled}
        />
      </View>
      <Text testID={TEST_IDS.settingsVersion}>{version}</Text>
      <Pressable
        accessibilityRole="button"
        testID={TEST_IDS.settingsDisconnect}
        onPress={() => void disconnect()}
      >
        <Text>Disconnect</Text>
      </Pressable>
    </View>
  );
}
