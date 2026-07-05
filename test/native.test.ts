import { platformName } from "@platform/native";
import { describe, expect, it } from "vitest";

describe("platformName", () => {
  it("reports the Capacitor platform (web under jsdom)", () => {
    expect(platformName()).toBe("web");
  });
});
