import { App } from "@capacitor/app";
import { isNativePlatform } from "./platform";

/**
 * Read the shipped identity from its native shell: the
 * marketing version and build number shown by stores. iOS sources them from
 * Info.plist; Android sources them from BuildConfig. Web has no native shell
 * or build number, so return null and let the UI keep its package-version
 * fallback.
 */
export async function getNativeAppVersion(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  const { version, build } = await App.getInfo();
  return `${version} (${build})`;
}
