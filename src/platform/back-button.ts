import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/** The bits of the router's history this seam drives. */
export interface BackHistory {
  /** How many entries deep the router is; `0` is a root tab. It moves only when
   * a pop's popstate lands, which is why the press handler subtracts the pop it
   * is issuing rather than re-reading this straight afterwards. */
  depth(): number;
  back(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * Honor the platform back contract on Android: while the router has history to
 * pop, Back pops it; at a root tab the handler is switched off so the system
 * plays the predictive back-to-home animation and closes the app itself. An
 * enabled handler is exactly what suppresses both, so the claim is re-read on
 * every history change rather than held open for the session. Android only: the
 * plugin leaves `toggleBackButtonHandler` unimplemented on iOS (where the edge
 * swipe is OS-handled) and on web, so calling it there is a rejected promise per
 * navigation. Returns a cleanup.
 */
export function bindHardwareBack(history: BackHistory): () => void {
  if (Capacitor.getPlatform() !== "android") return () => {};
  const claim = (depth: number): void => {
    void App.toggleBackButtonHandler({ enabled: depth > 0 });
  };
  claim(history.depth());
  const unsubscribe = history.subscribe(() => claim(history.depth()));
  const handle = App.addListener("backButton", () => {
    // The entry this press spends is gone as far as the user is concerned, so
    // the claim is computed from the pop rather than re-read: a second press
    // arriving before the pop lands belongs to the system, not to a router that
    // has nothing left to give it.
    claim(history.depth() - 1);
    history.back();
  });
  return () => {
    unsubscribe();
    void handle.then((h) => h.remove());
  };
}
