import type { AppVisibility } from "@cue/core/ports/app-visibility";
import { AppState } from "react-native";

/**
 * `AppState` is the native answer to the Page Visibility API the web app reads.
 * Only "active" counts as in front of the user: "inactive" is the iOS state
 * during a call banner, the app switcher or a system prompt, where nothing is
 * being read and the freshness poll should not spend Trakt's budget.
 */
export const nativeAppVisibility: AppVisibility = {
  isVisible: () => AppState.currentState === "active",
  subscribe: (listener) => {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
};
