import type { PlannedReminder } from "@domain/reminders";
import { createContext, useContext } from "react";

/**
 * The notification port, injected from the composition root so `@ui` stays free
 * of `@app`/`@platform`. `requestPermission` is fired from the Settings toggle
 * and nowhere else, so the OS prompt always arrives in the context of a
 * deliberate opt-in; `reconcile` makes the OS hold exactly the plan it is given
 * and is safe to call on every calendar refresh; `cancelAll` empties it. None of
 * them ever rejects, so a caller can `void` them. The default schedules nothing
 * and grants everything, which keeps the Settings switch a plain preference on
 * the web build exactly as the haptics one is, so neither needs a provider.
 */
export interface Reminders {
  requestPermission(): Promise<boolean>;
  reconcile(planned: readonly PlannedReminder[]): Promise<void>;
  cancelAll(): Promise<void>;
}

const SILENT: Reminders = {
  requestPermission: () => Promise.resolve(true),
  reconcile: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
};

const RemindersContext = createContext<Reminders>(SILENT);

export const RemindersProvider = RemindersContext.Provider;

export function useReminders(): Reminders {
  return useContext(RemindersContext);
}
