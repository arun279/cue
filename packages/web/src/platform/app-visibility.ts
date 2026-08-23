import type { AppVisibility } from "@cue/core/runtime/app-visibility";

/** `AppVisibility` over the Page Visibility API. */
export const webAppVisibility: AppVisibility = {
  isVisible: () => document.visibilityState !== "hidden",
  subscribe(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
