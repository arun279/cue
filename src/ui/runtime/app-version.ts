import { createContext, useContext } from "react";

/**
 * The app identity Settings renders, injected from the composition root so
 * `@ui` stays free of `@app`/`@platform`. The inert default supports isolated
 * callers; the composition root supplies the package or native version in the
 * real app.
 */
const EMPTY_APP_VERSION = "";

const AppVersionContext = createContext<string>(EMPTY_APP_VERSION);

export const AppVersionProvider = AppVersionContext.Provider;

export function useAppVersion(): string {
  return useContext(AppVersionContext);
}
