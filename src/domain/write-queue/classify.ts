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
 * `Retry-After` as ms, accepts a delta-seconds value or an HTTP-date, clamped
 * to `[0, BACKOFF_MAX_MS]`. This is the single parse point every honored wait
 * flows through (write-queue retry delay, the OAuth-refresh throttle floor, and
 * the read rate-limit sleep), so the clamp lives here to bound them all at once.
 * The header is advisory and Trakt can name a wait of minutes; honoring it
 * verbatim would freeze the sync pill across the queue's five attempts (and stall
 * reads/refresh) for that whole span. Capping at the same ceiling the
 * self-computed backoff uses keeps any one wait bounded no matter who set it,
 * while still respecting a shorter server request.
 */
export function parseRetryAfterMs(
  headers: Readonly<Record<string, string>>,
  now: number,
): number | null {
  const raw = headerValue(headers, "retry-after");
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return clampWaitMs(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : clampWaitMs(date - now);
}

/** Bound a wait to `[0, BACKOFF_MAX_MS]`: see `parseRetryAfterMs`. */
function clampWaitMs(ms: number): number {
  return Math.min(BACKOFF_MAX_MS, Math.max(0, ms));
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
