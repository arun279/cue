import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { diffReminders, type PendingReminder, type PlannedReminder } from "@domain/reminders";
import { isNativePlatform } from "./platform";

/**
 * Android 8+ drops any notification posted without a channel, and a channel's
 * behavior is fixed at creation, so this one exists to be the single thing the
 * user can silence without turning Cue's notifications off wholesale.
 */
const CHANNEL_ID = "cue-airing-today";

/** Groups consecutive days into one stack on iOS instead of separate banners. */
const THREAD_ID = CHANNEL_ID;

/** Matches Android's IMPORTANCE_DEFAULT: it makes a sound, it does not barge in
 * as a heads-up. A digest about the evening is not urgent. */
const IMPORTANCE_DEFAULT = 3;

/** Structurally the `@ui` Reminders port, so the composition root can inject it;
 * `@ui` never imports this (dependency-cruiser: @capacitor/* lives only here). */
export interface NativeReminders {
  requestPermission(): Promise<boolean>;
  reconcile(planned: readonly PlannedReminder[]): Promise<void>;
  cancelAll(): Promise<void>;
}

const SILENT: NativeReminders = {
  requestPermission: () => Promise.resolve(true),
  reconcile: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
};

function toPending(notification: { id: number; extra?: unknown }): PendingReminder {
  const extra = notification.extra;
  const fingerprint =
    typeof extra === "object" && extra !== null && "fingerprint" in extra
      ? String((extra as { fingerprint: unknown }).fingerprint)
      : null;
  return { id: notification.id, fingerprint };
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
export function createNativeReminders(): NativeReminders {
  if (!isNativePlatform()) return SILENT;
  const android = Capacitor.getPlatform() === "android";
  let channel: Promise<void> | null = null;
  const ensureChannel = (): Promise<void> => {
    // createChannel is Android-only; it rejects as unimplemented on iOS.
    channel ??= android
      ? LocalNotifications.createChannel({
          id: CHANNEL_ID,
          name: "Airing today",
          description: "One notification each morning listing what airs that day.",
          importance: IMPORTANCE_DEFAULT,
        })
      : Promise.resolve();
    return channel;
  };

  return {
    async requestPermission() {
      const { display } = await LocalNotifications.requestPermissions();
      if (display !== "granted") return false;
      await ensureChannel();
      return true;
    },

    async reconcile(planned) {
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
            threadIdentifier: THREAD_ID,
            extra: { fingerprint: reminder.fingerprint },
            isExactNotification: false,
            schedule: { at: new Date(reminder.atMs), allowWhileIdle: true },
          })),
        });
      }
    },

    cancelAll: () => LocalNotifications.cancelAll(),
  };
}
