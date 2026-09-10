import { nativeApplicationVersion, nativeBuildVersion } from "expo-application";

/**
 * The app-store-facing identity Settings renders: the marketing version and the
 * build number stores show. iOS sources both from `Info.plist`, Android from
 * `BuildConfig`, and prebuild writes both from `app.config.ts`, so this is the
 * far end of the same two environment variables the release lane sets.
 *
 * Constants rather than a call, and null-tolerant because they are only null
 * where there is no native shell to read.
 */
export const nativeAppVersion =
  nativeApplicationVersion === null || nativeBuildVersion === null
    ? "Unknown"
    : `${nativeApplicationVersion} (${nativeBuildVersion})`;
