import { App } from "@capacitor/app";
import { isNativePlatform } from "./platform";

/**
 * Honor the platform back contract on native Android: the
 * hardware/gesture Back button maps to the injected `onBack`, which pops the
 * router when there is history to pop and returns `true`; at a root tab it
 * returns `false` and this seam exits the app. Registering the listener overrides
 * Capacitor's default WebView-history back, so there is no double-fire with the
 * router's own `popstate`. No-op on web / in tests, the browser owns Back, and
 * on iOS, where system edge-swipe is OS-handled. Returns a cleanup.
 */
export function bindHardwareBack(onBack: () => boolean): () => void {
  if (!isNativePlatform()) return () => {};
  const handle = App.addListener("backButton", () => {
    if (!onBack()) void App.exitApp();
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}
