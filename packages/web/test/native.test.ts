import { isNativePlatform } from "@platform/platform";
import { describe, expect, it } from "vitest";

describe("isNativePlatform", () => {
  it("reports web (not native) under jsdom", () => {
    expect(isNativePlatform()).toBe(false);
  });
});
