import { type Reminders, SILENT } from "@cue/core/domain/ports/reminders";
import { createContext, useContext } from "react";

/** The notification port as `@ui` reaches it, injected from the composition root
 * so `@ui` stays free of `@app`/`@platform`. The default schedules nothing and
 * grants everything, so no provider is needed off native. */
const RemindersContext = createContext<Reminders>(SILENT);

export const RemindersProvider = RemindersContext.Provider;

export function useReminders(): Reminders {
  return useContext(RemindersContext);
}
