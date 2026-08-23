import {
  backoffMs,
  classifyStatus,
  computePacingDelay,
  MIN_WRITE_INTERVAL_MS,
  parseRetryAfterMs,
} from "@domain/write-queue/classify";
import { describe, expect, it } from "vitest";
import { dispatchResult } from "./_helpers";

describe("classifyStatus", () => {
  it("treats 2xx as ok", () => {
    expect(classifyStatus(dispatchResult(200), 0, 0).kind).toBe("ok");
    expect(classifyStatus(dispatchResult(201), 0, 0).kind).toBe("ok");
  });

  it("safe-retries 429 honoring Retry-After, else backoff", () => {
    expect(classifyStatus(dispatchResult(429, { "Retry-After": "3" }), 0, 0)).toEqual({
      kind: "retry",
      delayMs: 3000,
    });
    expect(classifyStatus(dispatchResult(429), 0, 0)).toEqual({ kind: "retry", delayMs: 1000 });
  });

  it("safe-retries 5xx with backoff", () => {
    expect(classifyStatus(dispatchResult(503), 1, 0)).toEqual({ kind: "retry", delayMs: 2000 });
  });

  it("fails on other 4xx (request did not apply → roll back)", () => {
    expect(classifyStatus(dispatchResult(404), 0, 0).kind).toBe("failed");
    expect(classifyStatus(dispatchResult(400), 0, 0).kind).toBe("failed");
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds, case-insensitively", () => {
    expect(parseRetryAfterMs({ "retry-after": "5" }, 0)).toBe(5000);
    expect(parseRetryAfterMs({ "Retry-After": "0" }, 0)).toBe(0);
  });
  it("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-07-05T00:00:00.000Z");
    const headers = { "retry-after": "Sun, 05 Jul 2026 00:00:10 GMT" };
    expect(parseRetryAfterMs(headers, now)).toBe(10000);
  });
  it("returns null for a missing or unparseable value", () => {
    expect(parseRetryAfterMs({}, 0)).toBeNull();
    expect(parseRetryAfterMs({ "retry-after": "soon" }, 0)).toBeNull();
  });
  it("clamps an over-long wait to the backoff ceiling so a server can't stall sync for minutes", () => {
    // A raw `Retry-After: 300` (5 min) is honored no longer than the 30s cap the
    // self-computed backoff already tops out at.
    expect(parseRetryAfterMs({ "retry-after": "300" }, 0)).toBe(30_000);
    const now = Date.parse("2026-07-05T00:00:00.000Z");
    const farFuture = { "retry-after": "Sun, 05 Jul 2026 00:10:00 GMT" };
    expect(parseRetryAfterMs(farFuture, now)).toBe(30_000);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the pacing floor and caps", () => {
    expect(backoffMs(0)).toBe(MIN_WRITE_INTERVAL_MS);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(100)).toBe(30000);
  });
});

describe("computePacingDelay", () => {
  it("is 0 on the first dispatch and floors at 0 once ≥1s has passed", () => {
    expect(computePacingDelay(500, null)).toBe(0);
    expect(computePacingDelay(5000, 1000)).toBe(0);
  });
  it("waits out the remaining interval", () => {
    expect(computePacingDelay(1300, 1000)).toBe(700);
  });
});
