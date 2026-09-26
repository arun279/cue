import { describe, expect, it } from "vitest";
import {
  initialMediaVisibility,
  persistMediaVisibility,
  resolveMediaVisibility,
} from "../../src/prefs/media-visibility";
import { fakeStorage } from "./_storage";

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
    expect(initialMediaVisibility(fakeStorage())).toEqual({
      showsEnabled: true,
      moviesEnabled: true,
    });
  });

  it("reads a persisted single-medium choice back", () => {
    const storage = fakeStorage();
    persistMediaVisibility(storage, { showsEnabled: true, moviesEnabled: false });
    expect(initialMediaVisibility(storage)).toEqual({ showsEnabled: true, moviesEnabled: false });

    persistMediaVisibility(storage, { showsEnabled: false, moviesEnabled: true });
    expect(initialMediaVisibility(storage)).toEqual({ showsEnabled: false, moviesEnabled: true });
  });

  it("reads a malformed value as off and an absent one as its default", () => {
    // Only "1" has ever meant on, so a present key is an answer however
    // malformed, while the absent movies key still reads as its default.
    const storage = fakeStorage({ "cue.shows-enabled": "yes" });
    expect(initialMediaVisibility(storage)).toEqual({ showsEnabled: false, moviesEnabled: true });
  });

  it("heals a both-off store rather than boot empty", () => {
    const storage = fakeStorage({ "cue.shows-enabled": "0", "cue.movies-enabled": "0" });
    expect(initialMediaVisibility(storage)).toEqual({ showsEnabled: true, moviesEnabled: true });
  });
});
