import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

/**
 * Lets the native splash go once the surface under it can draw something real.
 * A rejection is swallowed: the splash module throws when there is no splash to
 * hide, which is not a reason to fail a launch.
 */
export function useSplashRelease(ready: boolean): void {
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
}
