import { useEffect, useState } from "react";
import { useReminders } from "../ports/reminders";
import { usePrefs } from "../prefs/prefs-store";
import { useTurnOnAlerts } from "./useTurnOnAlerts";

export interface AlertsCard {
  dismiss(): void;
  turnOn(): Promise<void>;
}

export function useAlertsCard(): AlertsCard | null {
  const reminders = useReminders();
  const enabled = usePrefs((state) => state.remindersEnabled);
  const answered = usePrefs((state) => state.alertsCardAnswered);
  const dismiss = usePrefs((state) => state.answerAlertsCard);
  const turnOn = useTurnOnAlerts();
  const [refused, setRefused] = useState(true);
  const asking = !enabled && !answered;

  useEffect(() => {
    if (asking) void reminders.permissionRefused().then(setRefused);
  }, [reminders, asking]);

  return asking && !refused ? { dismiss, turnOn } : null;
}
