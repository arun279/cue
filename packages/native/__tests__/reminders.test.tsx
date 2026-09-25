import type { PlannedReminder } from "@cue/core/domain/reminders";
import { act, renderHook } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { createNativeReminders, useOpenTappedReminder } from "../src/platform/reminders";

type Request = Notifications.NotificationRequestInput;

/** The OS's pending store and its permission answer, as far as the adapter can see them. */
const mockOs = {
  granted: true,
  canAskAgain: true,
  pending: new Map<string, Request>(),
  lastResponse: null as object | null,
};

jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: mockOs.granted, canAskAgain: mockOs.canAskAgain }),
  ),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: mockOs.granted })),
  getAllScheduledNotificationsAsync: jest.fn(() =>
    Promise.resolve(
      [...mockOs.pending.values()].map(({ identifier, content }) => ({ identifier, content })),
    ),
  ),
  scheduleNotificationAsync: jest.fn((request: Request) => {
    mockOs.pending.set(String(request.identifier), request);
    return Promise.resolve(request.identifier);
  }),
  cancelScheduledNotificationAsync: jest.fn((id: string) => {
    mockOs.pending.delete(id);
    return Promise.resolve();
  }),
  cancelAllScheduledNotificationsAsync: jest.fn(() => {
    mockOs.pending.clear();
    return Promise.resolve();
  }),
  useLastNotificationResponse: () => mockOs.lastResponse,
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

const DAY_MS = 86_400_000;
const START = Date.parse("2026-10-01T09:00:00");

function summary(day: number, body: string): PlannedReminder {
  const atMs = START + day * DAY_MS;
  return {
    id: `day-${day}`,
    atMs,
    title: "Airing today",
    body,
    showId: null,
    fingerprint: `${atMs}|Airing today|${body}`,
  };
}

const scheduledIds = (): string[] =>
  jest
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map(([r]) => String(r.identifier));

beforeEach(() => {
  jest.clearAllMocks();
  mockOs.granted = true;
  mockOs.canAskAgain = true;
  mockOs.pending.clear();
  mockOs.lastResponse = null;
});

describe("the native reminders adapter", () => {
  it("leaves the OS holding exactly the plan, scheduling only what changed", async () => {
    const reminders = createNativeReminders();
    await reminders.reconcile([
      summary(0, "Harbor Lights S1 E1"),
      summary(1, "Salt Air S2 E4"),
      summary(2, "Tin Harbour S1 E3"),
    ]);
    jest.clearAllMocks();

    const plan = [
      summary(0, "Harbor Lights S1 E1"),
      summary(1, "Salt Air and Tin Harbour"),
      summary(3, "Harbor Lights S1 E2"),
    ];
    await reminders.reconcile(plan);

    expect(scheduledIds().sort()).toEqual(["day-1", "day-3"]);
    expect([...mockOs.pending.keys()].sort()).toEqual(["day-0", "day-1", "day-3"]);
    for (const reminder of plan) {
      const held = mockOs.pending.get(reminder.id);
      expect(held?.content).toMatchObject({ title: reminder.title, body: reminder.body });
      expect(held?.trigger).toMatchObject({ date: reminder.atMs });
    }
  });

  it("schedules nothing and never prompts when notifications are not allowed", async () => {
    mockOs.granted = false;
    await createNativeReminders().reconcile([summary(0, "Harbor Lights S1 E1")]);

    expect(mockOs.pending.size).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("empties the OS schedule, even when asked while a reconcile is still in flight", async () => {
    const reminders = createNativeReminders();
    await reminders.reconcile([summary(0, "Harbor Lights S1 E1")]);

    const inFlight = reminders.reconcile([
      summary(1, "Salt Air S2 E4"),
      summary(2, "Tin Harbour S1 E3"),
    ]);
    await reminders.cancelAll();
    await inFlight;

    expect(mockOs.pending.size).toBe(0);
  });

  it("asks for alerts and sound, never a badge, and answers with the OS's decision", async () => {
    const reminders = createNativeReminders();
    await expect(reminders.requestPermission()).resolves.toBe(true);
    mockOs.granted = false;
    await expect(reminders.requestPermission()).resolves.toBe(false);
    expect(jest.mocked(Notifications.requestPermissionsAsync).mock.calls[0]?.[0]?.ios).toEqual({
      allowAlert: true,
      allowSound: true,
    });
  });

  it("reads the permission as refused once the OS will no longer ask, or cannot say", async () => {
    const reminders = createNativeReminders();
    await expect(reminders.permissionRefused()).resolves.toBe(false);
    mockOs.canAskAgain = false;
    await expect(reminders.permissionRefused()).resolves.toBe(true);
    mockOs.canAskAgain = true;
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockImplementationOnce(() => Promise.reject(new Error("unavailable")));
    await expect(reminders.permissionRefused()).resolves.toBe(true);
  });

  it("resolves every call when the OS rejects, refusing the permission", async () => {
    const refused = () => Promise.reject(new Error("unavailable"));
    jest.mocked(Notifications.requestPermissionsAsync).mockImplementationOnce(refused);
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementationOnce(refused);
    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockImplementationOnce(refused);
    const reminders = createNativeReminders();

    await expect(reminders.requestPermission()).resolves.toBe(false);
    await expect(reminders.reconcile([summary(0, "Harbor Lights S1 E1")])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
    await reminders.reconcile([summary(0, "Harbor Lights S1 E1")]);
    expect([...mockOs.pending.keys()]).toEqual(["day-0"]);
  });

  it("opens the show from a tapped alert and the Calendar from a tapped summary, once each", async () => {
    const reminders = createNativeReminders();
    await reminders.reconcile([
      { ...summary(0, "S3 E6 The Long Dark is out."), id: "alert", showId: 8801 },
      { ...summary(1, "Harbor Lights S3 E7"), id: "summary" },
    ]);
    const tap = (id: string) => ({
      notification: { request: { identifier: id, content: mockOs.pending.get(id)?.content } },
    });

    mockOs.lastResponse = tap("alert");
    const { rerender } = await renderHook(() => useOpenTappedReminder());
    expect(router.navigate).toHaveBeenLastCalledWith("/show/8801");

    mockOs.lastResponse = tap("summary");
    await act(async () => rerender({}));
    expect(router.navigate).toHaveBeenLastCalledWith("/calendar");

    mockOs.lastResponse = null;
    await act(async () => rerender({}));
    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(2);
  });
});
