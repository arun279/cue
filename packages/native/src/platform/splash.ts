import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

/** Lets the native splash go once the surface under it can draw something real. */
export function useSplashRelease(ready: boolean): void {
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);
}
