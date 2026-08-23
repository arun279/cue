import type { PlannedReminder } from "@domain/reminders";
import { createNativeReminders } from "@platform/reminders";
import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  requestPermissions: vi.fn(async () => ({ display: "granted" })),
  checkPermissions: vi.fn(async () => ({ display: "granted" })),
  createChannel: vi.fn(async () => {}),
  getPending: vi.fn(async () => ({ notifications: [] as { id: number; extra?: unknown }[] })),
  schedule: vi.fn(async (_options: { notifications: readonly unknown[] }) => {}),
  cancel: vi.fn(async (_options: { notifications: readonly { id: number }[] }) => {}),
  cancelAll: vi.fn(async () => {}),
}));

const platform = vi.hoisted(() => ({ name: "android" }));

vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: plugin }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.name } }));
vi.mock("@platform/platform", () => ({ isNativePlatform: () => true }));

const digest = (id: number): PlannedReminder => ({
  id,
  atMs: Date.UTC(2026, 7, 24, 14),
  title: "Airing today",
  body: "Midnight Cartography S2 E5",
  fingerprint: `${id}|Airing today|Midnight Cartography S2 E5`,
});

describe("the native reminders seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.name = "android";
  });

  it("checks the permission before scheduling, so only the toggle can prompt", async () => {
    plugin.checkPermissions.mockResolvedValueOnce({ display: "denied" });

    await createNativeReminders().reconcile([digest(20_690)]);

    // schedule() asks for the permission itself when it is missing, which would
    // put the OS prompt in front of someone who never turned reminders on.
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("schedules the plan inexactly, on its own channel, carrying its fingerprint", async () => {
    await createNativeReminders().reconcile([digest(20_690)]);

    expect(plugin.schedule).toHaveBeenCalledTimes(1);
    expect(plugin.schedule.mock.calls[0]?.[0]).toMatchObject({
      notifications: [
        {
          id: 20_690,
          channelId: "cue-airing-today",
          extra: { fingerprint: digest(20_690).fingerprint },
          // The manifest strips SCHEDULE_EXACT_ALARM, so an exact request would
          // send the user to the system Alarms and reminders screen for a
          // permission the app does not have.
          isExactNotification: false,
          schedule: { allowWhileIdle: true },
        },
      ],
    });
  });

  it("cancels only what the plan dropped and leaves an unchanged day alone", async () => {
    const kept = digest(20_690);
    plugin.getPending.mockResolvedValueOnce({
      notifications: [
        { id: kept.id, extra: { fingerprint: kept.fingerprint } },
        { id: 20_689, extra: { fingerprint: "yesterday" } },
      ],
    });

    await createNativeReminders().reconcile([kept]);

    expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 20_689 }] });
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it("retries the Android channel after a failed creation instead of giving up for good", async () => {
    plugin.createChannel.mockRejectedValueOnce(new Error("no channel"));
    const reminders = createNativeReminders();

    await reminders.reconcile([digest(20_690)]);
    await reminders.reconcile([digest(20_690)]);

    expect(plugin.createChannel).toHaveBeenCalledTimes(2);
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
  });

  it("leaves the Android-only channel alone on iOS and schedules anyway", async () => {
    platform.name = "ios";

    await createNativeReminders().reconcile([digest(20_690)]);

    // createChannel is documented as unimplemented on iOS, so it rejects there,
    // and the seam's catch would swallow the whole reconcile with it: the
    // digest would silently never be scheduled.
    expect(plugin.createChannel).not.toHaveBeenCalled();
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
  });

  it("never rejects, whichever plugin call fails", async () => {
    plugin.requestPermissions.mockRejectedValueOnce(new Error("no plugin"));
    plugin.getPending.mockRejectedValueOnce(new Error("no plugin"));
    plugin.cancelAll.mockRejectedValueOnce(new Error("no plugin"));
    const reminders = createNativeReminders();

    // A refusal and a rejection have to look the same to the Settings switch:
    // both leave it off, and neither may surface as an unhandled rejection.
    await expect(reminders.requestPermission()).resolves.toBe(false);
    await expect(reminders.reconcile([digest(20_690)])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
  });
});
