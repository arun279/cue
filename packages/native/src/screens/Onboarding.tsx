import { useAuth } from "@cue/core/auth/store";
import type { ReactElement } from "react";
import { Linking, Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * The device-code sign-in. Unstyled: the visual layer is its own piece of work,
 * and what this has to be right about first is the flow.
 *
 * The activation URL is rendered beside the code, which the spike did not do.
 * `verificationUrl` is already computed by the auth store and was thrown away;
 * a device flow that shows a code with no destination is not usable against
 * real Trakt.
 */
export function Onboarding(): ReactElement {
  const status = useAuth((s) => s.connectStatus);
  const deviceCode = useAuth((s) => s.deviceCode);
  const errorMessage = useAuth((s) => s.errorMessage);
  const connect = useAuth((s) => s.connectWithDeviceCode);
  const cancel = useAuth((s) => s.cancelConnect);

  if (deviceCode !== null) {
    return (
      <SafeAreaView testID="screen-device-code">
        <Text accessibilityRole="header">Connect to Trakt</Text>
        <Text>Open this page and enter the code:</Text>
        <Pressable
          accessibilityRole="link"
          testID="device-code-url"
          onPress={() => void Linking.openURL(deviceCode.verificationUrl)}
        >
          <Text>{deviceCode.verificationUrl}</Text>
        </Pressable>
        <Text testID="device-code-value" accessibilityLabel={`Your code is ${deviceCode.userCode}`}>
          {deviceCode.userCode}
        </Text>
        <Pressable accessibilityRole="button" testID="device-code-cancel" onPress={cancel}>
          <Text>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="screen-onboarding">
      <Text accessibilityRole="header">Cue</Text>
      <Text>Your Up Next queue, from your Trakt account.</Text>
      {errorMessage !== null && <Text accessibilityRole="alert">{errorMessage}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: status === "connecting" }}
        testID="button-connect"
        disabled={status === "connecting"}
        onPress={() => void connect()}
      >
        <Text>{status === "connecting" ? "Connecting…" : "Connect to Trakt"}</Text>
      </Pressable>
    </SafeAreaView>
  );
}
