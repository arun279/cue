import type { AppVisibility } from "@cue/core/ports/app-visibility";
import { AppState } from "react-native";

// iOS reports inactive during a call banner, the app switcher or a system prompt.
export const nativeAppVisibility: AppVisibility = {
  isVisible: () => AppState.currentState === "active",
  subscribe: (listener) => {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
};
