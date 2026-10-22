import { queryKeys } from "@cue/core/data/query-keys";
import { describe, expect, it } from "vitest";

describe("queryKeys factory", () => {
  it("the history prefix is a strict prefix of every history key, across scopes", () => {
    expect(queryKeys.history("all").slice(0, 1)).toEqual(queryKeys.historyPrefix());
    expect(queryKeys.history("movies", "2019").slice(0, 1)).toEqual(queryKeys.historyPrefix());
  });
});
