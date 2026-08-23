/**
 * The four context-carrying ports with no provider above them.
 *
 * Each one documents the same promise: a tree mounted without a composition
 * root still works, silently. It is what lets the pre-token shell render before
 * a runtime exists, what makes the Settings reminder switch a plain preference
 * on a build with no notifications, and what every suite that mounts a screen
 * without wiring four providers depends on without saying so.
 */

import { useAppVisibility } from "@cue/core/runtime/app-visibility";
import { useHaptics } from "@cue/core/runtime/haptics";
import { useNetwork } from "@cue/core/runtime/network";
import { useReminders } from "@cue/core/runtime/reminders";
import { describe, expect, it } from "vitest";
import { mount } from "./_mount";

function readPort<T>(usePort: () => T): T {
  let value: T | null = null;
  function Probe(): null {
    value = usePort();
    return null;
  }
  mount(<Probe />);
  if (value === null) throw new Error("the probe never rendered");
  return value;
}

describe("a tree with no composition root above it", () => {
  it("believes it is in front of the user, and never hears otherwise", () => {
    const visibility = readPort(useAppVisibility);
    expect(visibility.isVisible()).toBe(true);
    expect(() => visibility.subscribe(() => {})()).not.toThrow();
  });

  it("believes it is online, and never hears otherwise", () => {
    const network = readPort(useNetwork);
    expect(network.isOnline()).toBe(true);
    expect(() => network.subscribe(() => {})()).not.toThrow();
  });

  it("stays silent rather than throwing when the UI fires a haptic", () => {
    const haptics = readPort(useHaptics);
    for (const verb of Object.values(haptics)) expect(() => verb()).not.toThrow();
  });

  it("grants the reminder permission and schedules nothing", async () => {
    const reminders = readPort(useReminders);
    await expect(reminders.requestPermission()).resolves.toBe(true);
    await expect(reminders.reconcile([])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
  });
});
