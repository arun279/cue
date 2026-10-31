import { createContext, useContext } from "react";
import type { PlannedReminder } from "../domain/reminders";

export interface Reminders {
  requestPermission(): Promise<boolean>;
  permissionRefused(): Promise<boolean>;
  reconcile(planned: readonly PlannedReminder[]): Promise<void>;
  cancelAll(): Promise<void>;
}

const SILENT: Reminders = {
  requestPermission: () => Promise.resolve(true),
  permissionRefused: () => Promise.resolve(false),
  reconcile: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
};

const RemindersContext = createContext<Reminders>(SILENT);

export const RemindersProvider = RemindersContext.Provider;

export function useReminders(): Reminders {
  return useContext(RemindersContext);
}
