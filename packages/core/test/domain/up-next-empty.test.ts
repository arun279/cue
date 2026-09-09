import { type UpNextComposition, upNextEmptyKind } from "@cue/core/domain/up-next";
import { describe, expect, it } from "vitest";

const composition = (overrides: Partial<UpNextComposition> = {}): UpNextComposition => ({
  queued: 0,
  totalCount: 7,
  trackedCount: 7,
  startedCount: 7,
  unresolvedCount: 0,
  hasData: true,
  ...overrides,
});

describe("upNextEmptyKind", () => {
  it("names no branch while a card renders, or before the read lands", () => {
    expect(upNextEmptyKind(composition({ queued: 1 }))).toBeNull();
    expect(upNextEmptyKind(composition({ hasData: false, totalCount: 0 }))).toBeNull();
  });

  it("reads an empty library as nothing tracked rather than as caught up", () => {
    expect(upNextEmptyKind(composition({ totalCount: 0, trackedCount: 0, startedCount: 0 }))).toBe(
      "nothing-tracked",
    );
  });

  it("reads a library of only stopped shows as stopped, not as empty", () => {
    expect(upNextEmptyKind(composition({ trackedCount: 0, startedCount: 0 }))).toBe("only-stopped");
  });

  it("reads a watchlist-only library as nothing started, not as caught up", () => {
    expect(upNextEmptyKind(composition({ startedCount: 0 }))).toBe("nothing-started");
  });

  it("refuses to call a library with unresolved shows caught up", () => {
    expect(upNextEmptyKind(composition({ unresolvedCount: 2 }))).toBe("unresolved");
    expect(upNextEmptyKind(composition())).toBe("caught-up");
  });
});
