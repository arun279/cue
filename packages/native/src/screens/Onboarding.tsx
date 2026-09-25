import { useAuth } from "@cue/core/auth/store";
import { useHaptics } from "@cue/core/ports/haptics";
import { setStringAsync } from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../ui/Button";
import { CueMark } from "../ui/CueMark";
import { useLiveRegion } from "../ui/live-region";
import { TEST_IDS } from "../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";

const WAITING = "Waiting for you to approve in Trakt…";

export function Onboarding(): ReactElement {
  const colors = useColors();
  const status = useAuth((s) => s.connectStatus);
  const deviceCode = useAuth((s) => s.deviceCode);
  const errorMessage = useAuth((s) => s.errorMessage);
  const connect = useAuth((s) => s.connectWithDeviceCode);
  const errorLive = useLiveRegion(errorMessage, "assertive");

  return (
    <SafeAreaView
      testID={deviceCode === null ? TEST_IDS.screenOnboarding : TEST_IDS.screenDeviceCode}
      style={[styles.page, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          {deviceCode === null ? (
            <>
              <CueMark />
              <CueText variant="statHero" accessibilityRole="header" style={{ color: colors.fg }}>
                Cue
              </CueText>
              <CueText variant="rowTitle" weight="regular" style={{ color: colors.ink2 }}>
                Your shows. One tap ahead.
              </CueText>
              <View style={styles.action}>
                {errorMessage === null ? null : (
                  <CueText
                    variant="meta"
                    accessibilityRole="alert"
                    {...errorLive}
                    style={{ color: colors.danger }}
                  >
                    {errorMessage}
                  </CueText>
                )}
                <Button
                  label={status === "connecting" ? "Connecting…" : "Connect Trakt"}
                  testID={TEST_IDS.buttonConnect}
                  disabled={status === "connecting"}
                  onPress={() => void connect()}
                />
              </View>
            </>
          ) : (
            <DeviceCode {...deviceCode} />
          )}
        </View>
        {deviceCode === null ? (
          <CueText variant="meta" style={{ color: colors.muted }}>
            Powered by Trakt. Your data lives in your Trakt account.
          </CueText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeviceCode({
  userCode,
  verificationUrl,
}: {
  readonly userCode: string;
  readonly verificationUrl: string;
}): ReactElement {
  const colors = useColors();
  const haptics = useHaptics();
  const cancel = useAuth((s) => s.cancelConnect);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waitingLive = useLiveRegion(WAITING, "polite");
  const copiedLive = useLiveRegion(copied ? "Copied" : null, "polite");

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void setStringAsync(userCode);
    haptics.selection();
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <CueText variant="detailTitle" accessibilityRole="header" style={{ color: colors.fg }}>
        Enter this code on Trakt
      </CueText>
      <Pressable
        accessibilityRole="button"
        testID={TEST_IDS.deviceCodeValue}
        accessibilityLabel={`Copy code ${userCode}`}
        onPress={copy}
        style={({ pressed }) => [
          styles.code,
          {
            backgroundColor: pressed ? colors.elevated : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <CueText
          variant="statHero"
          tabularNums
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: colors.fg }}
        >
          {userCode}
        </CueText>
        <CueText variant="meta" {...copiedLive} style={{ color: colors.muted }}>
          {copied ? "Copied" : "Tap to copy"}
        </CueText>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        testID={TEST_IDS.deviceCodeUrl}
        style={styles.target}
        onPress={() => void openBrowserAsync(verificationUrl)}
      >
        <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
          Enter it at{" "}
          <CueText
            variant="rowTitleSecondary"
            style={{ color: colors.accentInk, textDecorationLine: "underline" }}
          >
            {verificationUrl.replace(/^https?:\/\//, "")}
          </CueText>
        </CueText>
      </Pressable>
      <CueText variant="meta" {...waitingLive} style={{ color: colors.muted }}>
        {WAITING}
      </CueText>
      <Button label="Cancel" variant="link" testID={TEST_IDS.deviceCodeCancel} onPress={cancel} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: SPACE.s5, paddingVertical: SPACE.s4 },
  content: { flexGrow: 1, justifyContent: "center", gap: SPACE.s3, paddingVertical: SPACE.s7 },
  action: { gap: SPACE.s3, paddingTop: SPACE.s5 },
  code: {
    minHeight: TARGET_MIN,
    minWidth: TARGET_MIN,
    padding: SPACE.s5,
    gap: SPACE.s2,
    borderWidth: HAIRLINE,
    borderRadius: RADIUS.card,
  },
  target: { justifyContent: "center", minHeight: TARGET_MIN, minWidth: TARGET_MIN },
});
