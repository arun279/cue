import {
  diffReminders,
  type PendingReminder,
  type PlannedReminder,
} from "@cue/core/domain/reminders";
import type { Reminders } from "@cue/core/ports/reminders";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

/**
 * Android 8 and later drop a notification posted without a channel, and a
 * channel's importance is fixed for every install once created. Default
 * importance makes a sound without a heads-up banner; iOS ignores the call. The
 * name is the Settings row's, so the system category and the switch that fills
 * it read the same.
 */
const CHANNEL_ID = "new-episodes";

const ensureChannel = (): Promise<unknown> =>
  Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "New episodes",
    importance: Notifications.AndroidImportance.DEFAULT,
  });

function toPending({ identifier, content }: Notifications.NotificationRequest): PendingReminder {
  const fingerprint = content.data?.["fingerprint"];
  return { id: identifier, fingerprint: typeof fingerprint === "string" ? fingerprint : null };
}

/**
 * Checked rather than requested, so the prompt only ever comes from the Settings
 * switch, and a later revoke in system settings simply stops the scheduling.
 * The identifier is the planner's id, so a replan addresses the notification
 * the last one scheduled.
 */
async function apply(planned: readonly PlannedReminder[]): Promise<void> {
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await ensureChannel();
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const { cancel, schedule } = diffReminders(planned, pending.map(toPending));
  await Promise.all(cancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  await Promise.all(
    schedule.map((reminder) =>
      Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { fingerprint: reminder.fingerprint, showId: reminder.showId },
          interruptionLevel: "active",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.atMs,
          channelId: CHANNEL_ID,
        },
      }),
    ),
  );
}

/**
 * Reconciles and cancels run one at a time, so a switch turned off while a
 * reconcile is still reading the OS cannot be followed by that reconcile's
 * schedule landing.
 */
export function createNativeReminders(): Reminders {
  let queue = Promise.resolve();
  const serially = (task: () => Promise<unknown>): Promise<void> => {
    queue = queue.then(task).then(
      () => {},
      () => {},
    );
    return queue;
  };

  return {
    requestPermission: () =>
      ensureChannel()
        .then(() =>
          Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }),
        )
        .then(
          ({ granted }) => granted,
          () => false,
        ),
    reconcile: (planned) => serially(() => apply(planned)),
    cancelAll: () => serially(() => Notifications.cancelAllScheduledNotificationsAsync()),
  };
}

/** A tap opens what the notification named: an alert its show, the summary the
 * Calendar, where a day lives. Cleared once handled, so a later mount does not
 * open it again. */
export function useOpenTappedReminder(): void {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    Notifications.clearLastNotificationResponse();
    const showId = response.notification.request.content.data?.["showId"];
    router.navigate(typeof showId === "number" ? `/show/${showId}` : "/calendar");
  }, [response]);
}
