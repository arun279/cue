import { bindHardwareBack } from "@platform/back-button";
import { createNativeHaptics } from "@platform/haptics";
import { createNativeReminders } from "@platform/reminders";
import { applyStatusBarTheme } from "@platform/status-bar";
import { describe, expect, it, vi } from "vitest";

/**
 * The native seams (haptics / reminders / hardware-back / status-bar) are additive
 * garnish that MUST be a silent no-op on web and in tests (jsdom reports the web
 * runtime): a missing Capacitor plugin or a browser tab can never break a job.
 * These tests pin that contract so a future regression to the web build is caught.
 */
describe("native seams degrade to silent no-ops on web", () => {
  it("createNativeHaptics fires nothing and never consults the settings toggle", () => {
    const isEnabled = vi.fn(() => true);
    const haptics = createNativeHaptics(isEnabled);
    // No throw, and the enabled-getter is never even read: web is unconditionally silent.
    expect(() => {
      haptics.success();
      haptics.thresholdActivate();
      haptics.thresholdDeactivate();
      haptics.selection();
      haptics.contextClick();
      haptics.prepare();
    }).not.toThrow();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("createNativeReminders schedules nothing and grants without an OS prompt", async () => {
    const reminders = createNativeReminders();
    // Granting on web keeps the Settings toggle a plain preference there, the
    // way the haptics one is; there is no notification to promise either way.
    await expect(reminders.requestPermission()).resolves.toBe(true);
    await expect(reminders.reconcile([])).resolves.toBeUndefined();
    await expect(reminders.cancelAll()).resolves.toBeUndefined();
  });

  it("bindHardwareBack never touches the history and returns a callable cleanup", () => {
    const history = {
      canGoBack: vi.fn(() => true),
      back: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    const cleanup = bindHardwareBack(history);
    expect(history.canGoBack).not.toHaveBeenCalled();
    expect(history.subscribe).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });

  it("applyStatusBarTheme is a no-op for both themes", () => {
    expect(() => {
      applyStatusBarTheme("dark");
      applyStatusBarTheme("light");
    }).not.toThrow();
  });
});
