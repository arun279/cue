import { nativeApplicationVersion, nativeBuildVersion } from "expo-application";

export const nativeAppVersion =
  nativeApplicationVersion === null || nativeBuildVersion === null
    ? "Unknown"
    : `${nativeApplicationVersion} (${nativeBuildVersion})`;
