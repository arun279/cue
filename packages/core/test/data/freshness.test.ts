import { TraktReadError } from "@cue/core/data/trakt/client";
import { combineStatus } from "@cue/core/queries/freshness";
import { describe, expect, it } from "vitest";

const settled = {
  isLoading: false,
  isFetching: false,
  isError: false,
  dataUpdatedAt: 2000,
  error: null,
  failureReason: null,
};

describe("combineStatus", () => {
  it("reports a screen fed by two reads as synced when its older read was", () => {
    expect(combineStatus([settled, { ...settled, dataUpdatedAt: 1000 }], true)).toMatchObject({
      isLoading: false,
      isError: false,
      syncedAt: 1000,
      failure: null,
      retrying: false,
    });
  });

  it("names the failure of whichever read failed, and a retry either one is making", () => {
    const failing = {
      ...settled,
      isFetching: true,
      failureReason: new TraktReadError({ kind: "network" }, "show progress"),
    };
    expect(combineStatus([{ ...settled, isLoading: true }, failing], true)).toMatchObject({
      isLoading: true,
      isFetching: true,
      failure: { kind: "network" },
      retrying: true,
    });
  });

  it("keeps a settled error once neither read is trying any more", () => {
    const failed = {
      ...settled,
      isError: true,
      error: new TraktReadError({ kind: "server", status: 502 }, "show info"),
    };
    expect(combineStatus([failed, settled], false)).toMatchObject({
      isError: true,
      hasData: false,
      failure: { kind: "server", status: 502 },
      retrying: false,
    });
  });
});
