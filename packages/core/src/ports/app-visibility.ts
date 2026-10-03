import { createContext, useContext } from "react";

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
