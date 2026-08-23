import { navFor } from "@ui/app-shell/nav";
import {
  initialMediaVisibility,
  persistMediaVisibility,
  resolveMediaVisibility,
} from "@ui/prefs/media-visibility";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  localStorage.clear();
});

describe("resolveMediaVisibility", () => {
  it("keeps both media on by default", () => {
    expect(resolveMediaVisibility(true, true)).toEqual({ showsEnabled: true, moviesEnabled: true });
  });

  it("preserves a single-medium choice", () => {
    expect(resolveMediaVisibility(true, false)).toEqual({
      showsEnabled: true,
      moviesEnabled: false,
    });
    expect(resolveMediaVisibility(false, true)).toEqual({
      showsEnabled: false,
      moviesEnabled: true,
    });
  });

  it("heals a corrupt both-off pair back to both-on (never an empty app)", () => {
    expect(resolveMediaVisibility(false, false)).toEqual({
      showsEnabled: true,
      moviesEnabled: true,
    });
  });
});

describe("initialMediaVisibility", () => {
  it("defaults to both-on on a fresh device (no stored keys)", () => {
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: true });
  });

  it("reads a persisted single-medium choice back", () => {
    persistMediaVisibility({ showsEnabled: true, moviesEnabled: false });
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: false });

    persistMediaVisibility({ showsEnabled: false, moviesEnabled: true });
    expect(initialMediaVisibility()).toEqual({ showsEnabled: false, moviesEnabled: true });
  });

  it("keeps a medium whose key was never written on", () => {
    // Only one of the pair was ever persisted, e.g. a store written by a build
    // that had no movies toggle yet.
    localStorage.setItem("cue.shows-enabled", "1");
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: true });
  });

  it("heals a both-off store rather than boot empty", () => {
    localStorage.setItem("cue.shows-enabled", "0");
    localStorage.setItem("cue.movies-enabled", "0");
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: true });
  });
});

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
