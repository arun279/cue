import { healthCheck } from "@data/health";
import { describe, expect, it } from "vitest";

describe("healthCheck", () => {
  it("reports ok and a domain-derived sample cue", () => {
    expect(healthCheck()).toEqual({ status: "ok", sampleCue: "S01E01" });
  });
});
