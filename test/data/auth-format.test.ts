import { checkTraktCredentials } from "@data/auth/format";
import { describe, expect, it } from "vitest";

const HEX64 = "a".repeat(64);

describe("checkTraktCredentials", () => {
  it("accepts two well-formed 64-char hex credentials", () => {
    expect(checkTraktCredentials(HEX64, HEX64)).toEqual([]);
  });

  it("flags empty fields as required", () => {
    const errors = checkTraktCredentials("", "   ");
    expect(errors.map((e) => e.field)).toEqual(["clientId", "clientSecret"]);
    expect(errors[0]?.message).toMatch(/required/i);
  });

  it("flags a wrong-length or non-hex value with the format hint", () => {
    const errors = checkTraktCredentials("too-short", `${HEX64}g`.slice(1));
    expect(errors.map((e) => e.field)).toEqual(["clientId", "clientSecret"]);
    expect(errors[0]?.message).toMatch(/64-character/);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(checkTraktCredentials(`  ${HEX64}  `, HEX64)).toEqual([]);
  });
});
