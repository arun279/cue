/**
 * The sync contract: what the app says when sync is not clean, and when it
 * changes its mind. These are the two defects stated as rules: a rate limit is
 * never called unreachable, and a mark's row moves on the clock rather than on a
 * round trip, so a deferred write can never leave a row looking green and stuck.
 */

import { describe, expect, it } from "vitest";
import { TraktReadError } from "../src/data/trakt/client";
import {
  appendToBatch,
  markControlTickMs,
  markRecordRetireMs,
  readFailureBody,
  resolveMarkControl,
  SYNC_BANNER_KINDS,
  type SyncBannerInput,
  shouldRetryRead,
  syncBanner,
  UNDO_WINDOW_MS,
} from "../src/sync-contract";

const NOW = 1_700_000_000_000;

const healthy: SyncBannerInput = {
  offline: false,
  failure: null,
  retrying: false,
  hasData: true,
  resumeReadsAt: 0,
  pending: 0,
  pendingLate: false,
  now: NOW,
};

const readError = (failure: TraktReadError["failure"]): TraktReadError =>
  new TraktReadError(failure, "watched shows");

describe("syncBanner", () => {
  it("says nothing at all when sync is healthy", () => {
    expect(syncBanner(healthy)).toBeNull();
  });

  it("never calls a rate limit unreachable, and offers no Retry for it", () => {
    const banner = syncBanner({
      ...healthy,
      failure: { kind: "rate-limited", retryAfterMs: 4000 },
      resumeReadsAt: NOW + 4000,
    });
    expect(banner?.kind).toBe("rate-limited");
    expect(banner?.message).not.toContain("unreachable");
    expect(banner?.message).not.toContain("Can't reach");
    // What is happening, and when it retries.
    expect(banner?.message).toBe("Trakt is limiting requests. Retrying in 4s.");
    expect(banner?.retryable).toBe(false);
  });

  it("counts the wait down and says so once the window is due to reopen", () => {
    const paused = { ...healthy, resumeReadsAt: NOW + 4000 };
    expect(syncBanner({ ...paused, now: NOW + 2500 })?.message).toContain("Retrying in 2s.");
    expect(syncBanner({ ...paused, now: NOW + 4000 })).toBeNull();
  });

  it("clears itself once the pause lifts and a read succeeds", () => {
    expect(syncBanner({ ...healthy, resumeReadsAt: NOW - 1 })).toBeNull();
  });

  it("stops claiming to retry once the window reopened and the read had given up", () => {
    const banner = syncBanner({
      ...healthy,
      failure: { kind: "rate-limited", retryAfterMs: 2000 },
      resumeReadsAt: NOW - 1,
    });
    expect(banner?.message).toBe("Couldn't refresh from Trakt. Showing your cached data.");
    expect(banner?.retryable).toBe(true);
  });

  it("names an outage an outage, over cached content, with a Retry", () => {
    const banner = syncBanner({ ...healthy, failure: { kind: "network" } });
    expect(banner).toEqual({
      kind: "unreachable",
      message: "Can't reach Trakt. Showing your cached data.",
      retryable: true,
    });
  });

  it("distinguishes Trakt having trouble from Trakt being unreachable", () => {
    const banner = syncBanner({ ...healthy, failure: { kind: "server", status: 503 } });
    expect(banner?.message).toBe("Trakt is having trouble. Showing your cached data.");
  });

  it("does not call a blip it is still chasing an outage, and offers no Retry for it", () => {
    // The defect over a warm cache: the strip announced "Can't reach Trakt" on
    // the FIRST failed attempt, held it for the backoff ladder, and then took it
    // away again when the retry healed it.
    const banner = syncBanner({ ...healthy, failure: { kind: "network" }, retrying: true });
    expect(banner).toEqual({
      kind: "retrying",
      message: "Couldn't refresh from Trakt. Retrying…",
      retryable: false,
    });
  });

  it("keeps a 5xx blip out of the outage line too, for as long as it is retrying", () => {
    const banner = syncBanner({
      ...healthy,
      failure: { kind: "server", status: 502 },
      retrying: true,
    });
    expect(banner?.kind).toBe("retrying");
    expect(banner?.message).not.toContain("Showing your cached data.");
  });

  it("names the outage once the read has given up, and offers the Retry then", () => {
    const banner = syncBanner({ ...healthy, failure: { kind: "network" }, retrying: false });
    expect(banner?.kind).toBe("unreachable");
    expect(banner?.retryable).toBe(true);
  });

  it("emits nothing outside the kinds it publishes", () => {
    const kinds = [
      syncBanner({ ...healthy, offline: true }),
      syncBanner({ ...healthy, resumeReadsAt: NOW + 1000 }),
      syncBanner({ ...healthy, failure: { kind: "network" }, retrying: true }),
      syncBanner({ ...healthy, failure: { kind: "network" } }),
      syncBanner({ ...healthy, pending: 3, pendingLate: true }),
    ].map((banner) => banner?.kind);
    expect(kinds).toEqual([...SYNC_BANNER_KINDS]);
  });

  it("never claims to be showing cached data when there is none", () => {
    const banner = syncBanner({ ...healthy, failure: { kind: "network" }, hasData: false });
    expect(banner).toBeNull();
  });

  it("puts offline first: an offline device fails every read, and the marks are safe", () => {
    const banner = syncBanner({
      ...healthy,
      offline: true,
      failure: { kind: "network" },
      pending: 9,
      pendingLate: true,
    });
    expect(banner?.message).toBe("Offline. Your marks are saved.");
  });

  it("surfaces a backlog only past the threshold and the grace window", () => {
    expect(syncBanner({ ...healthy, pending: 3, pendingLate: false })).toBeNull();
    expect(syncBanner({ ...healthy, pending: 2, pendingLate: true })).toBeNull();
    expect(syncBanner({ ...healthy, pending: 3, pendingLate: true })?.message).toBe(
      "3 marks pending · will sync",
    );
  });
});

describe("readFailureBody", () => {
  it("does not blame the connection for a rate limit", () => {
    expect(readFailureBody({ kind: "rate-limited", retryAfterMs: null })).toBe(
      "Trakt is limiting requests. Cue will try again shortly.",
    );
  });

  it("does blame the connection for a transport failure", () => {
    expect(readFailureBody({ kind: "network" })).toBe("Check your connection and try again.");
  });
});

describe("read retry policy", () => {
  it("retries a 5xx and a transport failure, and stops at the budget", () => {
    expect(shouldRetryRead(0, readError({ kind: "server", status: 500 }))).toBe(true);
    expect(shouldRetryRead(0, readError({ kind: "network" }))).toBe(true);
    expect(shouldRetryRead(2, readError({ kind: "network" }))).toBe(false);
  });

  it("leaves a rate limit to the read pool, which is already retrying it", () => {
    // Two ladders over one 429 multiply an aggregate read into the very window
    // that asked for less traffic. The pool honours Retry-After and holds every
    // other read behind the same pause, so it owns this one alone.
    expect(shouldRetryRead(0, readError({ kind: "rate-limited", retryAfterMs: 7000 }))).toBe(false);
    expect(shouldRetryRead(0, readError({ kind: "rate-limited", retryAfterMs: null }))).toBe(false);
  });

  it("never retries a failure that will not heal, nor a non-read throw", () => {
    expect(shouldRetryRead(0, readError({ kind: "unauthorized" }))).toBe(false);
    expect(shouldRetryRead(0, readError({ kind: "not-found" }))).toBe(false);
    expect(shouldRetryRead(0, readError({ kind: "server", status: 422 }))).toBe(false);
    expect(shouldRetryRead(0, readError({ kind: "server", status: 400 }))).toBe(false);
    expect(shouldRetryRead(0, new Error("bad shape"))).toBe(false);
  });
});

describe("resolveMarkControl", () => {
  const base = { pendingAdvance: true, title: "Harbor Lights", episodeCode: "S3 E6", now: NOW };

  it("is green and reversible for the undo window", () => {
    const view = resolveMarkControl({ ...base, markedAt: NOW - 100 });
    expect(view).toEqual({
      state: "just-marked",
      pending: false,
      label: "Watched. Tap to remove.",
    });
  });

  it("stops being green the moment the undo window closes, write or no write", () => {
    const view = resolveMarkControl({ ...base, markedAt: NOW - UNDO_WINDOW_MS });
    expect(view.state).toBe("advancing");
  });

  it("stays green no longer than the window even when the mark never reaches Trakt", () => {
    // The defect: a deferred write left the row green indefinitely. An hour on,
    // with the advance still unconfirmed, the row is advanced and quiet.
    const view = resolveMarkControl({ ...base, markedAt: NOW - 3_600_000 });
    expect(view.state).toBe("advancing");
    expect(view.pending).toBe(true);
    expect(view.label).toBe("Watched. Not synced yet.");
  });

  it("shows no pending indicator while the mark is still take-back-able", () => {
    const view = resolveMarkControl({ ...base, markedAt: NOW - UNDO_WINDOW_MS + 1 });
    expect(view.state).toBe("just-marked");
    expect(view.pending).toBe(false);
  });

  it("reports nothing outstanding for a row advancing from another surface's mark", () => {
    const view = resolveMarkControl({ ...base, markedAt: null });
    expect(view).toEqual({ state: "advancing", pending: false, label: "Watched." });
  });

  it("re-arms for the next episode once Trakt has named it", () => {
    const view = resolveMarkControl({
      ...base,
      markedAt: null,
      pendingAdvance: false,
    });
    expect(view).toEqual({
      state: "unwatched",
      pending: false,
      label: "Mark Harbor Lights S3 E6 watched",
    });
  });
});

describe("mark control timing", () => {
  it("schedules the close of the green window and nothing after it", () => {
    expect(markControlTickMs(NOW, NOW)).toBe(UNDO_WINDOW_MS);
    expect(markControlTickMs(NOW - 1000, NOW)).toBe(UNDO_WINDOW_MS - 1000);
    expect(markControlTickMs(NOW - UNDO_WINDOW_MS, NOW)).toBeNull();
    expect(markControlTickMs(null, NOW)).toBeNull();
  });

  it("never retires a record while the next episode is still a guess", () => {
    expect(markRecordRetireMs(NOW, true, NOW + 900_000)).toBeNull();
  });

  it("retires it once the authoritative next has landed and the window has run", () => {
    expect(markRecordRetireMs(NOW, false, NOW + 1000)).toBe(UNDO_WINDOW_MS - 1000);
    expect(markRecordRetireMs(NOW, false, NOW + 9000)).toBe(0);
  });
});

describe("appendToBatch", () => {
  const at = (ms: number) => ({ at: ms });

  it("coalesces marks inside the undo window and starts a batch past it", () => {
    let batch: readonly { at: number }[] = appendToBatch([], at(0));
    batch = appendToBatch(batch, at(UNDO_WINDOW_MS));
    expect(batch).toHaveLength(2);
    expect(appendToBatch(batch, at(2 * UNDO_WINDOW_MS + 1))).toEqual([at(2 * UNDO_WINDOW_MS + 1)]);
  });
});
