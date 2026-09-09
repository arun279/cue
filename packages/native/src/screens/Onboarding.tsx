import { useAuth } from "@cue/core/auth/store";
import type { ReactElement } from "react";
import { Linking, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";

/**
 * The device-code sign-in, on the type roles and the page fill the rest of the
 * app draws with. It is still a placeholder: the brand mark, the code card and
 * its copy target, and the footer saying where the data lives all belong to the
 * screen this becomes.
 *
 * The activation URL is rendered beside the code, which the spike did not do.
 * `verificationUrl` is already computed by the auth store and was thrown away;
 * a device flow that shows a code with no destination is not usable against
 * real Trakt.
 */
export function Onboarding(): ReactElement {
  const colors = useColors();
  const status = useAuth((s) => s.connectStatus);
  const deviceCode = useAuth((s) => s.deviceCode);
  const errorMessage = useAuth((s) => s.errorMessage);
  const connect = useAuth((s) => s.connectWithDeviceCode);
  const cancel = useAuth((s) => s.cancelConnect);

  if (deviceCode !== null) {
    return (
      <SafeAreaView
        testID={TEST_IDS.screenDeviceCode}
        style={[styles.page, { backgroundColor: colors.bg }]}
      >
        <CueText variant="detailTitle" accessibilityRole="header" style={{ color: colors.fg }}>
          Connect to Trakt
        </CueText>
        <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
          Open this page and enter the code:
        </CueText>
        <Pressable
          accessibilityRole="link"
          testID={TEST_IDS.deviceCodeUrl}
          style={styles.target}
          onPress={() => void Linking.openURL(deviceCode.verificationUrl)}
        >
          <CueText variant="rowTitleSecondary" style={{ color: colors.accentInk }}>
            {deviceCode.verificationUrl}
          </CueText>
        </Pressable>
        <CueText
          variant="detailTitle"
          tabularNums
          testID={TEST_IDS.deviceCodeValue}
          accessibilityLabel={`Your code is ${deviceCode.userCode}`}
          style={{ color: colors.fg }}
        >
          {deviceCode.userCode}
        </CueText>
        <Pressable
          accessibilityRole="button"
          testID={TEST_IDS.deviceCodeCancel}
          style={styles.target}
          onPress={cancel}
        >
          <CueText variant="meta" style={{ color: colors.muted }}>
            Cancel
          </CueText>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      testID={TEST_IDS.screenOnboarding}
      style={[styles.page, { backgroundColor: colors.bg }]}
    >
      <CueText variant="statHero" accessibilityRole="header" style={{ color: colors.fg }}>
        Cue
      </CueText>
      <CueText variant="rowTitle" weight="regular" style={{ color: colors.ink2 }}>
        Your Up Next queue, from your Trakt account.
      </CueText>
      {errorMessage === null ? null : (
        <CueText variant="meta" accessibilityRole="alert" style={{ color: colors.danger }}>
          {errorMessage}
        </CueText>
      )}
      <Button
        label={status === "connecting" ? "Connecting…" : "Connect to Trakt"}
        testID={TEST_IDS.buttonConnect}
        disabled={status === "connecting"}
        onPress={() => void connect()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", paddingHorizontal: SPACE.s5, gap: SPACE.s3 },
  target: { justifyContent: "center", minHeight: TARGET_MIN },
});
