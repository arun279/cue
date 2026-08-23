import { createContext, useContext } from "react";
import type { PlannedReminder } from "../domain/reminders";

/**
 * The notification port, declared where both sides of the seam can read it:
 * `@ui` drives it, `@platform` implements it, and the composition root hands one
 * to the other. `requestPermission` is fired from the Settings toggle and
 * nowhere else, so the OS prompt always arrives in the context of a deliberate
 * opt-in; `reconcile` makes the OS hold exactly the plan it is given and is safe
 * to call on every calendar refresh; `cancelAll` empties it. None of them ever
 * rejects, so a caller can `void` them.
 */
export interface Reminders {
  requestPermission(): Promise<boolean>;
  reconcile(planned: readonly PlannedReminder[]): Promise<void>;
  cancelAll(): Promise<void>;
}

/**
 * The port's promise not to reject, applied rather than restated by each
 * implementation. A permission revoked mid-call, a missing plugin or an OS
 * refusal cannot be recovered from at this seam, and an unhandled rejection in a
 * shell is worse than the honest fallback: nothing granted, nothing scheduled.
 */
export function neverRejects(reminders: Reminders): Reminders {
  return {
    requestPermission: () => reminders.requestPermission().catch(() => false),
    reconcile: (planned) => reminders.reconcile(planned).catch(() => {}),
    cancelAll: () => reminders.cancelAll().catch(() => {}),
  };
}

/** Schedules nothing and grants everything, which keeps the Settings switch a
 * plain preference on the web build exactly as the haptics one is. */
export const SILENT: Reminders = {
  requestPermission: () => Promise.resolve(true),
  reconcile: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
};

/** The port as `@ui` reaches it, injected from the composition root so `@ui`
 * stays free of `@app`/`@platform`. The default is `SILENT`, so no provider is
 * needed off native. */
const RemindersContext = createContext<Reminders>(SILENT);

export const RemindersProvider = RemindersContext.Provider;

export function useReminders(): Reminders {
  return useContext(RemindersContext);
}
