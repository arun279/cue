import { PendingWritesError } from "@cue/core/app/session";
import { useAuth } from "@cue/core/auth/store";
import { type ReactElement, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { useLiveRegion } from "../../ui/live-region";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function SignOut(): ReactElement {
  const disconnect = useAuth((state) => state.disconnect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colors = useColors();
  const liveRegion = useLiveRegion(error, "assertive");
  async function signOut(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await disconnect();
    } catch (failure) {
      setError(
        failure instanceof PendingWritesError
          ? "Some changes haven't synced yet. Reconnect to the internet, then try signing out again."
          : "Couldn't finish signing out. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const label = busy ? "Signing out…" : "Sign out";
  return (
    <View>
      {error ? (
        <CueText
          testID={TEST_IDS.signOutError}
          variant="meta"
          style={{ color: colors.danger }}
          {...liveRegion}
        >
          {error}
        </CueText>
      ) : null}
      <Pressable
        testID={TEST_IDS.settingsDisconnect}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        style={{ minHeight: ROW_MIN_HEIGHT.settings, justifyContent: "center" }}
        onPress={() =>
          Alert.alert("Sign out of Cue?", "Your Trakt history stays on Trakt.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign out",
              onPress: () => void signOut(),
              ...(Platform.OS === "ios" ? { isPreferred: true } : {}),
            },
          ])
        }
      >
        <CueText variant="rowTitle" weight="regular" style={{ color: colors.danger }}>
          {label}
        </CueText>
      </Pressable>
    </View>
  );
}
