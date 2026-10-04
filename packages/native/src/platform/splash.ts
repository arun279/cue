import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

export function useSplashRelease(ready: boolean): void {
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);
}
