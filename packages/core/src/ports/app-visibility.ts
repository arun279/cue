import { createContext, useContext } from "react";

/**
 * Whether the app is in front of the user, and a subscription to that changing,
 * injected from the composition root so the shared layer never reads
 * `document`. The freshness poll is gated on it: an app in the background spends no
 * Trakt budget. The web answers with the Page Visibility API, a device with
 * `AppState`. The default is always-visible-never-changing, so the pre-token
 * shell and an isolated test need no provider.
 */
export interface AppVisibility {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
}

const ALWAYS_VISIBLE: AppVisibility = {
  isVisible: () => true,
  subscribe: () => () => {},
};

const AppVisibilityContext = createContext<AppVisibility>(ALWAYS_VISIBLE);

export const AppVisibilityProvider = AppVisibilityContext.Provider;

export function useAppVisibility(): AppVisibility {
  return useContext(AppVisibilityContext);
}
