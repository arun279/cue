// @vitest-environment jsdom
/**
 * The two device-local alert controls outside Settings: the Calendar card that
 * asks once, and the per-show mute with its Undo.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAlertsCard } from "@/core/hooks/useAlertsCard";
import { useAlertsMute } from "@/core/hooks/useAlertsMute";
import type { PreferenceStorage } from "@/core/ports/preference-storage";
import { type Reminders, RemindersProvider } from "@/core/ports/reminders";
import { createPrefsStore, PrefsProvider } from "@/core/prefs/prefs-store";
import { dismissSnack, snackText, useSnackbar } from "@/core/stores/snackbar-store";
import { memoryPreferenceStorage } from "../support/stores";

afterEach(dismissSnack);

const REFUSAL = "Notifications are off for Cue. Turn them on in your phone's settings.";

const snack = (): string | null => {
  const shown = useSnackbar.getState().snack;
  return shown === null ? null : snackText(shown.message);
};

function os({ refused = false, granted = true } = {}): Reminders {
  return {
    requestPermission: vi.fn(() => Promise.resolve(granted)),
    permissionRefused: () => Promise.resolve(refused),
    reconcile: () => Promise.resolve(),
    cancelAll: () => Promise.resolve(),
  };
}

async function mountCard(
  reminders: Reminders,
  storage: PreferenceStorage = memoryPreferenceStorage(),
) {
  const prefs = createPrefsStore(storage);
  const { result } = renderHook(useAlertsCard, {
    wrapper: ({ children }) => (
      <PrefsProvider value={prefs}>
        <RemindersProvider value={reminders}>{children}</RemindersProvider>
      </PrefsProvider>
    ),
  });
  await act(async () => {});
  return { prefs, card: () => result.current };
}

describe("useAlertsCard", () => {
  it("asks while alerts are off, it is unanswered and the OS would still prompt", async () => {
    expect((await mountCard(os())).card()).not.toBeNull();
  });

  it.each([
    ["alerts are on", os(), { "cue.reminders-enabled": "1" }],
    ["it was answered", os(), { "cue.alerts-card-answered": "1" }],
    ["the OS has been refused", os({ refused: true }), {}],
  ])("stays away once %s", async (_, reminders, seed) => {
    expect((await mountCard(reminders, memoryPreferenceStorage(seed))).card()).toBeNull();
  });

  it("goes for good on Not now, without asking the OS", async () => {
    const reminders = os();
    const storage = memoryPreferenceStorage();
    const { card } = await mountCard(reminders, storage);

    act(() => card()?.dismiss());

    expect(card()).toBeNull();
    expect(createPrefsStore(storage).getState().alertsCardAnswered).toBe(true);
    expect(reminders.requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    [true, null],
    [false, REFUSAL],
  ])("goes once the OS answers, alerts on only if it allowed (%s)", async (granted, said) => {
    const { card, prefs } = await mountCard(os({ granted }));

    await act(async () => card()?.turnOn());

    expect(card()).toBeNull();
    expect(prefs.getState().remindersEnabled).toBe(granted);
    expect(snack()).toBe(said);
  });
});

describe("useAlertsMute", () => {
  it("mutes a show with an Undo, and lifts the mute without one", async () => {
    const prefs = createPrefsStore(memoryPreferenceStorage());
    const { result } = renderHook(() => useAlertsMute(8801, "Harbor Lights"), {
      wrapper: ({ children }) => <PrefsProvider value={prefs}>{children}</PrefsProvider>,
    });
    await act(async () => {});
    expect(result.current.label).toBe("Mute episode alerts");

    act(() => result.current.toggle());
    expect(prefs.getState().mutedShowIds).toEqual([8801]);
    expect(result.current.label).toBe("Unmute episode alerts");
    expect(snack()).toBe("Episode alerts muted for Harbor Lights.");

    act(() => useSnackbar.getState().snack?.actions?.[0]?.onPress());
    expect(prefs.getState().mutedShowIds).toEqual([]);
    expect(snack()).toBeNull();

    act(() => result.current.toggle());
    act(dismissSnack);
    act(() => result.current.toggle());
    expect(prefs.getState().mutedShowIds).toEqual([]);
    expect(snack()).toBeNull();
  });
});
