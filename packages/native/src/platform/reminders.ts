import {
  diffReminders,
  type PendingReminder,
  type PlannedReminder,
} from "@cue/core/domain/reminders";
import { neverRejects, type Reminders } from "@cue/core/ports/reminders";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Android 8+ drops any notification posted without a channel, and a channel's
 * behavior is fixed at creation, so this one exists to be the single thing the
 * user can silence without turning Cue's notifications off wholesale. It also
 * has to exist before the runtime permission is asked for, or the OS prompt
 * never appears.
 */
const CHANNEL_ID = "cue-airing-today";

/** Collects the digests under one heading in iOS Notification Center. Each one
 * still arrives as its own banner: threading groups what is already delivered. */
const THREAD_ID = CHANNEL_ID;

function toPending(request: Notifications.NotificationRequest): PendingReminder {
  const fingerprint = request.content.data?.["fingerprint"];
  return {
    id: Number(request.identifier),
    fingerprint: typeof fingerprint === "string" ? fingerprint : null,
  };
}

/**
 * The notification seam on a device: the permission ask, the Android channel,
 * and the reconcile that makes the OS hold exactly the plan the domain produced.
 *
 * Every reminder is scheduled inexactly, and that is a property of the app's
 * manifest rather than of this call. `expo-notifications` asks
 * `AlarmManager.canScheduleExactAlarms()` and takes `setExactAndAllowWhileIdle`
 * when it can and `setAndAllowWhileIdle` when it cannot
 * (`ExpoSchedulingDelegate.kt:106-120`), and `app.config.ts` blocks
 * `SCHEDULE_EXACT_ALARM`, so the second branch is the only one this app takes.
 * That is the answer Android's own guidance prescribes for a user-specified time
 * that may fall during Doze, it keeps the "Alarms & reminders" screen out of the
 * first-run experience, and a morning digest does not care about a quarter hour.
 *
 * The identifier is the planner's own day id as a string, so a replan addresses
 * the same notification the last one scheduled rather than cancelling the world.
 */
export function createNativeReminders(): Reminders {
  let channelReady = false;

  const ensureChannel = async (): Promise<void> => {
    if (Platform.OS !== "android" || channelReady) return;
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Airing today",
      description: "One notification each morning naming what airs that day.",
      // Makes a sound; does not barge in as a heads-up. A digest about the
      // evening is not urgent.
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    channelReady = true;
  };

  const grant = async (): Promise<boolean> => {
    // The channel first: on Android 13 and later the POST_NOTIFICATIONS prompt
    // does not appear at all until one exists.
    await ensureChannel();
    const { granted } = await Notifications.requestPermissionsAsync();
    return granted;
  };

  const apply = async (planned: readonly PlannedReminder[]): Promise<void> => {
    // Checked rather than requested, so the prompt can only ever come from the
    // Settings toggle, and a later revoke in system settings simply stops the
    // scheduling.
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;
    await ensureChannel();
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const { cancel, schedule } = diffReminders(planned, pending.map(toPending));
    for (const id of cancel) {
      await Notifications.cancelScheduledNotificationAsync(String(id));
    }
    for (const reminder of schedule) {
      await Notifications.scheduleNotificationAsync({
        identifier: String(reminder.id),
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { fingerprint: reminder.fingerprint },
          ...(Platform.OS === "ios" ? { threadIdentifier: THREAD_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(reminder.atMs),
          channelId: CHANNEL_ID,
        },
      });
    }
  };

  return neverRejects({
    requestPermission: grant,
    reconcile: apply,
    cancelAll: () => Notifications.cancelAllScheduledNotificationsAsync(),
  });
}
