import { navFor } from "@ui/app-shell/nav";
import { describe, expect, it } from "vitest";

describe("navFor", () => {
  it("maps the four tabs while TV is enabled (default + TV-only)", () => {
    expect(navFor({ showsEnabled: true }).map((d) => d.path)).toEqual([
      "/",
      "/library",
      "/calendar",
      "/search",
    ]);
  });

  it("sheds the episodic Up Next AND Calendar for a movies-only app", () => {
    expect(navFor({ showsEnabled: false }).map((d) => d.path)).toEqual(["/library", "/search"]);
  });
});
