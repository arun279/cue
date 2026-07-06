import { checkTraktCredentials } from "@data/auth/format";
import { describe, expect, it } from "vitest";

const HEX64 = "a".repeat(64);

describe("checkTraktCredentials", () => {
  it("accepts a well-formed 64-char hex client ID", () => {
    expect(checkTraktCredentials(HEX64)).toEqual([]);
  });

  it("flags an empty client ID as required", () => {
    const errors = checkTraktCredentials("   ");
    expect(errors.map((e) => e.field)).toEqual(["clientId"]);
    expect(errors[0]?.message).toMatch(/required/i);
  });

  it("flags a wrong-length or non-hex value with the format hint", () => {
    const errors = checkTraktCredentials("too-short");
    expect(errors.map((e) => e.field)).toEqual(["clientId"]);
    expect(errors[0]?.message).toMatch(/64-character/);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(checkTraktCredentials(`  ${HEX64}  `)).toEqual([]);
  });
});
