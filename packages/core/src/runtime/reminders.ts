import { createContext, useContext } from "react";
import { type Reminders, SILENT } from "../domain/ports/reminders";

/** The notification port as `@ui` reaches it, injected from the composition root
 * so `@ui` stays free of `@app`/`@platform`. The default schedules nothing and
 * grants everything, so no provider is needed off native. */
const RemindersContext = createContext<Reminders>(SILENT);

export const RemindersProvider = RemindersContext.Provider;

export function useReminders(): Reminders {
  return useContext(RemindersContext);
}
