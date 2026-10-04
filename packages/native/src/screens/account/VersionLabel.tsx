import { useAppVersion } from "@cue/core/ports/app-version";
import { showSnack } from "@cue/core/stores/snackbar-store";
import { channel } from "expo-updates";
import type { ReactElement } from "react";
import { Alert, Platform, Pressable } from "react-native";
import { PREVIEW_CHANNEL, setPreviewUpdates } from "../../platform/update-channel";
import { TEST_IDS } from "../../ui/test-ids";
import { useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

async function switchChannel(preview: boolean): Promise<void> {
  try {
    await setPreviewUpdates(preview);
  } catch {
    showSnack({ message: "Couldn't check for updates. The switch applies when Cue next starts." });
  }
}

function confirmSwitch(preview: boolean): void {
  Alert.alert(
    "Preview updates",
    preview
      ? "Get updates before friends do, to try them first. Cue restarts to switch."
      : "This install gets preview updates. Go back to the updates friends get? Cue restarts to switch.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: preview ? "Turn on" : "Turn off",
        onPress: () => void switchChannel(preview),
        ...(Platform.OS === "ios" ? { isPreferred: true } : {}),
      },
    ],
  );
}

// A long press on the version is the owner's way onto the preview channel. Builds
// without a channel, such as development and test builds, have nothing to switch.
export function VersionLabel(): ReactElement {
  const colors = useColors();
  const version = useAppVersion();
  const onPreview = channel === PREVIEW_CHANNEL;
  return (
    <Pressable
      onLongPress={channel === null ? undefined : () => confirmSwitch(!onPreview)}
      delayLongPress={1000}
    >
      <CueText
        testID={TEST_IDS.settingsVersion}
        variant="rowTitle"
        weight="regular"
        style={{ color: colors.muted }}
      >
        {onPreview ? `${version} · preview` : version}
      </CueText>
    </Pressable>
  );
}
