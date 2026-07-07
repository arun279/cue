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

  it('treats only an explicit "0" as disabled', () => {
    localStorage.setItem("cue.shows-enabled", "1");
    // movies key absent → still on.
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: true });
  });

  it("heals a both-off store rather than boot empty", () => {
    localStorage.setItem("cue.shows-enabled", "0");
    localStorage.setItem("cue.movies-enabled", "0");
    expect(initialMediaVisibility()).toEqual({ showsEnabled: true, moviesEnabled: true });
  });
});

describe("navFor", () => {
  it("shows all three primary tabs while TV is enabled (default + TV-only)", () => {
    expect(navFor({ showsEnabled: true }).map((d) => d.path)).toEqual([
      "/",
      "/calendar",
      "/library",
    ]);
  });

  it("sheds the TV-centric Up Next + Calendar tabs for a movies-only app", () => {
    const destinations = navFor({ showsEnabled: false });
    expect(destinations).toHaveLength(1);
    expect(destinations[0]?.path).toBe("/library");
  });
});
