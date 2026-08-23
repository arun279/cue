import { createContext, useContext } from "react";
import { type Haptics, SILENT } from "../domain/ports/haptics";

/** The tactile port as `@ui` reaches it, injected from the composition root so
 * `@ui` stays free of `@app`/`@platform`. The default is the silent no-op, so
 * the browser build, the pre-token shell and tests need no provider. */
const HapticsContext = createContext<Haptics>(SILENT);

export const HapticsProvider = HapticsContext.Provider;

export function useHaptics(): Haptics {
  return useContext(HapticsContext);
}
