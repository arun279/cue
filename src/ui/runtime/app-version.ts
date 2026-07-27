import { createContext, useContext } from "react";
import { version } from "../../../package.json";

/**
 * The app identity Settings renders, injected from the composition root so
 * `@ui` stays free of `@app`/`@platform`. The default is the package version,
 * so the browser build and tests need no provider; native replaces it with the
 * shipped version and build.
 */
const AppVersionContext = createContext<string>(version);

export const AppVersionProvider = AppVersionContext.Provider;

export function useAppVersion(): string {
  return useContext(AppVersionContext);
}
