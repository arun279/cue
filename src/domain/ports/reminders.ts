import type { PlannedReminder } from "@domain/reminders";

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

/** Schedules nothing and grants everything, which keeps the Settings switch a
 * plain preference on the web build exactly as the haptics one is. */
export const SILENT: Reminders = {
  requestPermission: () => Promise.resolve(true),
  reconcile: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
};
