import type { Haptics } from "@cue/core/ports/haptics";
import { createNativeHaptics } from "@platform/haptics";
import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  success: vi.fn(async () => {}),
  thresholdActivate: vi.fn(async () => {}),
  thresholdDeactivate: vi.fn(async () => {}),
  selection: vi.fn(async () => {}),
  contextClick: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "ios" },
  registerPlugin: () => plugin,
}));

/** Every port method and the plugin method it must reach. The native side owns
 * which system effect each one plays; this seam only owns the routing. */
const vocabulary = [
  ["success", plugin.success],
  ["thresholdActivate", plugin.thresholdActivate],
  ["thresholdDeactivate", plugin.thresholdDeactivate],
  ["selection", plugin.selection],
  ["contextClick", plugin.contextClick],
  ["prepare", plugin.prepare],
] as const satisfies readonly (readonly [keyof Haptics, unknown])[];

describe("the native haptics seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(vocabulary)("routes %s to its own plugin method and nothing else", (method, expected) => {
    createNativeHaptics(() => true)[method]();
    for (const [, fn] of vocabulary) {
      expect(fn).toHaveBeenCalledTimes(fn === expected ? 1 : 0);
    }
  });

  it("fires nothing while the Settings toggle is off", () => {
    const haptics = createNativeHaptics(() => false);
    for (const [method] of vocabulary) haptics[method]();
    for (const [, fn] of vocabulary) expect(fn).not.toHaveBeenCalled();
  });

  // Reduce Motion is a visual-motion preference; the platforms carry their own
  // separate haptics settings and honour them below this seam. Gating here once
  // took feedback away from exactly the people the guidance wants to give more
  // of it to, so this pins that the gate is gone.
  it("still fires under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    createNativeHaptics(() => true).success();
    expect(plugin.success).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("swallows a plugin rejection so a missing engine never breaks a mark", () => {
    plugin.success.mockRejectedValueOnce(new Error("no engine"));
    expect(() => createNativeHaptics(() => true).success()).not.toThrow();
  });
});
