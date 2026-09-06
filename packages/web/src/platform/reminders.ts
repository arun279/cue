import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  diffReminders,
  type PendingReminder,
  type PlannedReminder,
} from "@cue/core/domain/reminders";
import { neverRejects, type Reminders, SILENT } from "@cue/core/ports/reminders";
import { isNativePlatform } from "./platform";

/**
 * Android 8+ drops any notification posted without a channel, and a channel's
 * behavior is fixed at creation, so this one exists to be the single thing the
 * user can silence without turning Cue's notifications off wholesale.
 */
const CHANNEL_ID = "cue-airing-today";

/** Matches Android's IMPORTANCE_DEFAULT: it makes a sound, it does not barge in
 * as a heads-up. A digest about the evening is not urgent. */
const IMPORTANCE_DEFAULT = 3;

function toPending(notification: {
  id: number;
  extra?: { fingerprint?: string } | null;
}): PendingReminder {
  return { id: notification.id, fingerprint: notification.extra?.fingerprint ?? null };
}

/**
 * Build the notification seam. Silent on web, where there is nothing to
 * schedule. On native it is the only place that talks to the plugin: the
 * permission ask, the Android channel, and the reconcile that makes the OS hold
 * exactly the plan the domain produced.
 *
 * Everything is scheduled inexact. The plugin defaults `isExactNotification` to
 * true, which on API 31+ drops the user into the system Alarms and reminders
 * screen the first time anything is scheduled; and exact alarms are denied by
 * default from Android 14, while the auto-granted alternative is restricted by
 * Play policy to alarm, timer and calendar apps. A morning digest is exactly the
 * case Android's own guidance answers with setAndAllowWhileIdle, which is what
 * `allowWhileIdle` without exactness selects.
 */
export function createNativeReminders(): Reminders {
  if (!isNativePlatform()) return SILENT;
  const android = Capacitor.getPlatform() === "android";
  let channelReady = false;

  const ensureChannel = async (): Promise<void> => {
    // createChannel is Android-only; it rejects as unimplemented on iOS. A
    // failed creation leaves the flag down, so the next pass tries again rather
    // than the first failure standing for the rest of the process.
    if (!android || channelReady) return;
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Airing today",
      description: "One notification each morning naming what airs that day.",
      importance: IMPORTANCE_DEFAULT,
    });
    channelReady = true;
  };

  const grant = async (): Promise<boolean> => {
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== "granted") return false;
    await ensureChannel();
    return true;
  };

  const apply = async (planned: readonly PlannedReminder[]): Promise<void> => {
    // schedule() requests the permission itself if it is missing. Check first
    // so the prompt can only ever come from the Settings toggle, and so a
    // later revoke in system settings simply stops the scheduling.
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    await ensureChannel();
    const { notifications } = await LocalNotifications.getPending();
    const { cancel, schedule } = diffReminders(planned, notifications.map(toPending));
    if (cancel.length > 0) {
      await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) });
    }
    if (schedule.length > 0) {
      await LocalNotifications.schedule({
        notifications: schedule.map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          channelId: CHANNEL_ID,
          // Collects the digests under one heading in iOS Notification Center.
          // Each still arrives as its own banner: threading groups what is
          // already delivered.
          threadIdentifier: CHANNEL_ID,
          extra: { fingerprint: reminder.fingerprint },
          isExactNotification: false,
          schedule: { at: new Date(reminder.atMs), allowWhileIdle: true },
        })),
      });
    }
  };

  return neverRejects({
    requestPermission: grant,
    reconcile: apply,
    cancelAll: () => LocalNotifications.cancelAll(),
  });
}
