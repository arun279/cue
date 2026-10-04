import { createContext, useContext } from "react";

const AppVersionContext = createContext<string>("");

export const AppVersionProvider = AppVersionContext.Provider;

export function useAppVersion(): string {
  return useContext(AppVersionContext);
}
