import { isNativePlatform } from "@platform/platform";
import { describe, expect, it } from "vitest";

describe("isNativePlatform", () => {
  it("reports the web runtime as non-native", () => {
    expect(isNativePlatform()).toBe(false);
  });
});
