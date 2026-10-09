export type TimeoutClass = "read" | "list" | "write";

export interface TraktPolicy {
  readonly timeoutMs: Readonly<Record<TimeoutClass, number>>;
  readonly readAttempts: number;
  readonly retryDelayMs: { readonly base: number; readonly max: number };
  readonly rateLimit: { readonly retries: number; readonly fallbackPauseMs: number };
  readonly readConcurrency: number;
  readonly pageSize: { readonly list: number; readonly history: number };
  readonly progressBudget: number;
}

export const DEFAULT_TRAKT_POLICY: TraktPolicy = {
  timeoutMs: { read: 15_000, list: 15_000, write: 15_000 },
  readAttempts: 3,
  retryDelayMs: { base: 1100, max: 30_000 },
  rateLimit: { retries: 3, fallbackPauseMs: 1000 },
  readConcurrency: 6,
  // Trakt caps extended=progress watched pages at 100 items (trakt/trakt-api discussion #775).
  pageSize: { list: 100, history: 30 },
  // Trakt allows 1000 authed GETs per 5 minutes.
  progressBudget: 60,
};
