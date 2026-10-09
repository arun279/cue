import { useReminders } from "../ports/reminders";
import { usePrefs } from "../prefs/prefs-store";
import { showSnack } from "../stores/snackbar-store";

export function useTurnOnAlerts(): () => Promise<void> {
  const reminders = useReminders();
  const setRemindersEnabled = usePrefs((state) => state.setRemindersEnabled);
  const answerAlertsCard = usePrefs((state) => state.answerAlertsCard);
  return async () => {
    answerAlertsCard();
    if (await reminders.requestPermission()) {
      setRemindersEnabled(true);
      return;
    }
    showSnack({ message: "Notifications are off for Cue. Turn them on in your phone's settings." });
  };
}
