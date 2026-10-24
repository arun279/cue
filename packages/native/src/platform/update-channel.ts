import * as Updates from "expo-updates";

export const PREVIEW_CHANNEL = "preview";

// https://docs.expo.dev/eas-update/channel-surfing/
export async function setPreviewUpdates(preview: boolean): Promise<void> {
  Updates.setUpdateRequestHeadersOverride(
    preview ? { "expo-channel-name": PREVIEW_CHANNEL } : null,
  );
  const update = await Updates.checkForUpdateAsync();
  if (update.isAvailable) await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
}
