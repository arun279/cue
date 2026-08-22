import { App } from "@capacitor/app";
import { isNativePlatform } from "./platform";

/** The bits of the router's history this seam drives. */
export interface BackHistory {
  canGoBack(): boolean;
  back(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * Honor the platform back contract on native Android: while the router has
 * history to pop, Back pops it; at a root tab the handler is switched off so
 * the system plays the predictive back-to-home animation and closes the app
 * itself. An enabled handler is exactly what suppresses both, so the claim is
 * re-read on every history change rather than held open for the session. No-op
 * on web / in tests, where the browser owns Back, and on iOS, where the edge
 * swipe is OS-handled. Returns a cleanup.
 */
export function bindHardwareBack(history: BackHistory): () => void {
  if (!isNativePlatform()) return () => {};
  const claim = (): void => {
    void App.toggleBackButtonHandler({ enabled: history.canGoBack() });
  };
  claim();
  const unsubscribe = history.subscribe(claim);
  const handle = App.addListener("backButton", () => {
    history.back();
    claim();
  });
  return () => {
    unsubscribe();
    void handle.then((h) => h.remove());
  };
}
