import {
  diffReminders,
  type PendingReminder,
  type PlannedReminder,
} from "@cue/core/domain/reminders";
import type { Reminders } from "@cue/core/ports/reminders";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

// Android 8 and later drop a notification posted without a channel, and a channel's importance is fixed once created.
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
    permissionRefused: () =>
      Notifications.getPermissionsAsync().then(
        ({ canAskAgain }) => !canAskAgain,
        () => true,
      ),
    reconcile: (planned) => serially(() => apply(planned)),
    cancelAll: () => serially(() => Notifications.cancelAllScheduledNotificationsAsync()),
  };
}

export function useOpenTappedReminder(): void {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    Notifications.clearLastNotificationResponse();
    const showId = response.notification.request.content.data?.["showId"];
    router.navigate(typeof showId === "number" ? `/show/${showId}` : "/calendar");
  }, [response]);
}
