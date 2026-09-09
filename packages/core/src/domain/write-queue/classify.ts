import type { DispatchResult } from "./types";

/** Trakt writes are capped at 1/sec: the hard limit that paces every dispatch. */
export const MIN_WRITE_INTERVAL_MS = 1000;

/**
 * Backoff floor = the write pacing interval (a shorter wait is pointless: the
 * pacer already enforces ≥1s); ceiling bounds BOTH the self-computed exponential
 * backoff AND an honored `Retry-After` (see `parseRetryAfterMs`), so a healed
 * server is retried promptly rather than after a runaway wait: whether that wait
 * is one Cue computed or one the server dictated.
 */
const BACKOFF_BASE_MS = MIN_WRITE_INTERVAL_MS;
const BACKOFF_MAX_MS = 30_000;
const READ_RETRY_AFTER_MAX_MS = 300_000;
const READ_RETRY_AFTER_MARGIN_MS = 500;

export type Classification =
  | { readonly kind: "ok" }
  | { readonly kind: "retry"; readonly delayMs: number }
  | { readonly kind: "failed" };

/**
 * Classify a completed dispatch (a *rejected* dispatch is a NetworkError, the
 * ambiguous class handled by the queue's reconcile path: not here):
 * 2xx = ok; 429/5xx = safe-retry (honor `Retry-After`, else backoff); any other
 * 4xx = a definite failure the request did not apply, so roll back.
 */
export function classifyStatus(
  result: DispatchResult,
  attempt: number,
  now: number,
): Classification {
  const s = result.status;
  if (s >= 200 && s < 300) return { kind: "ok" };
  if (s === 429 || (s >= 500 && s < 600)) {
    const retryAfter = parseRetryAfterMs(result.headers, now);
    return { kind: "retry", delayMs: retryAfter ?? backoffMs(attempt) };
  }
  return { kind: "failed" };
}

/**
 * A write `Retry-After` as ms, accepting delta seconds or an HTTP date and
 * clamping it to the write queue's bounded backoff ceiling.
 */
export function parseRetryAfterMs(
  headers: Readonly<Record<string, string>>,
  now: number,
): number | null {
  return parseRetryAfter(headers, now, BACKOFF_MAX_MS, 0);
}

export function parseReadRetryAfterMs(
  headers: Readonly<Record<string, string>>,
  now: number,
): number | null {
  return parseRetryAfter(headers, now, READ_RETRY_AFTER_MAX_MS, READ_RETRY_AFTER_MARGIN_MS);
}

function parseRetryAfter(
  headers: Readonly<Record<string, string>>,
  now: number,
  maxMs: number,
  marginMs: number,
): number | null {
  const raw = headerValue(headers, "retry-after");
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return clampWaitMs(seconds * 1000, maxMs) + marginMs;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : clampWaitMs(date - now, maxMs) + marginMs;
}

function clampWaitMs(ms: number, maxMs: number): number {
  return Math.min(maxMs, Math.max(0, ms));
}

export function backoffMs(attempt: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  return Math.min(BACKOFF_MAX_MS, exp);
}

/** Ms to wait before the next dispatch to keep dispatches ≥1s apart. */
export function computePacingDelay(now: number, lastDispatchAt: number | null): number {
  if (lastDispatchAt === null) return 0;
  return Math.max(0, MIN_WRITE_INTERVAL_MS - (now - lastDispatchAt));
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}
