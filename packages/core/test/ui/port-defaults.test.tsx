// @vitest-environment jsdom
/**
 * The context-carrying device ports with no provider above them.
 *
 * Each one documents the same promise: a tree mounted without a composition
 * root still works, silently. It is what lets the pre-token shell render before
 * a runtime exists, what makes the Settings reminder switch a plain preference
 * on a build with no notifications, and what every suite that mounts a screen
 * without wiring those providers depends on without saying so.
 */

import { useHaptics } from "@cue/core/ports/haptics";
import { useReminders } from "@cue/core/ports/reminders";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const readPort = <T,>(usePort: () => T): T => renderHook(usePort).result.current;

describe("a tree with no composition root above it", () => {
  it("stays silent rather than throwing when the UI fires a haptic", () => {
    const haptics = readPort(useHaptics);
    for (const verb of Object.values(haptics)) expect(() => verb()).not.toThrow();
  });

  it("grants the reminder permission, has never refused it, and schedules nothing", async () => {
    const reminders = readPort(useReminders);
    await expect(reminders.requestPermission()).resolves.toBe(true);
    await expect(reminders.permissionRefused()).resolves.toBe(false);
    await expect(reminders.reconcile([])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
  });
});
