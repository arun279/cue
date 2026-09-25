import type { PlannedReminder } from "@cue/core/domain/reminders";
import { act, renderHook } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { createNativeReminders, useCalendarOnReminderTap } from "../src/platform/reminders";

type Request = Notifications.NotificationRequestInput;

/** The OS's pending store and its permission answer, as far as the adapter can see them. */
const mockOs = {
  granted: true,
  pending: new Map<string, Request>(),
  lastResponse: null as object | null,
};

jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: mockOs.granted })),
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

function digest(day: number, body: string): PlannedReminder {
  const atMs = START + day * DAY_MS;
  return {
    id: 20_000 + day,
    atMs,
    title: "Airing today",
    body,
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
  mockOs.pending.clear();
  mockOs.lastResponse = null;
});

describe("the native reminders adapter", () => {
  it("leaves the OS holding exactly the plan, scheduling only what changed", async () => {
    const reminders = createNativeReminders();
    await reminders.reconcile([
      digest(0, "Harbor Lights S1 E1"),
      digest(1, "Salt Air S2 E4"),
      digest(2, "Tin Harbour S1 E3"),
    ]);
    jest.clearAllMocks();

    const plan = [
      digest(0, "Harbor Lights S1 E1"),
      digest(1, "Salt Air and Tin Harbour"),
      digest(3, "Harbor Lights S1 E2"),
    ];
    await reminders.reconcile(plan);

    expect(scheduledIds().sort()).toEqual(["20001", "20003"]);
    expect([...mockOs.pending.keys()].sort()).toEqual(["20000", "20001", "20003"]);
    for (const reminder of plan) {
      const held = mockOs.pending.get(String(reminder.id));
      expect(held?.content).toMatchObject({ title: reminder.title, body: reminder.body });
      expect(held?.trigger).toMatchObject({ date: reminder.atMs });
    }
  });

  it("schedules nothing and never prompts when notifications are not allowed", async () => {
    mockOs.granted = false;
    await createNativeReminders().reconcile([digest(0, "Harbor Lights S1 E1")]);

    expect(mockOs.pending.size).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("empties the OS schedule, even when asked while a reconcile is still in flight", async () => {
    const reminders = createNativeReminders();
    await reminders.reconcile([digest(0, "Harbor Lights S1 E1")]);

    const inFlight = reminders.reconcile([
      digest(1, "Salt Air S2 E4"),
      digest(2, "Tin Harbour S1 E3"),
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

  it("resolves every call when the OS rejects, refusing the permission", async () => {
    const refused = () => Promise.reject(new Error("unavailable"));
    jest.mocked(Notifications.requestPermissionsAsync).mockImplementationOnce(refused);
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementationOnce(refused);
    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockImplementationOnce(refused);
    const reminders = createNativeReminders();

    await expect(reminders.requestPermission()).resolves.toBe(false);
    await expect(reminders.reconcile([digest(0, "Harbor Lights S1 E1")])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
    await reminders.reconcile([digest(0, "Harbor Lights S1 E1")]);
    expect([...mockOs.pending.keys()]).toEqual(["20000"]);
  });

  it("opens the Calendar from a tapped digest, once", async () => {
    mockOs.lastResponse = { notification: { request: { identifier: "20000" } } };
    const { rerender } = await renderHook(() => useCalendarOnReminderTap());
    expect(router.navigate).toHaveBeenCalledWith("/calendar");
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    mockOs.lastResponse = null;
    await act(async () => rerender({}));
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
