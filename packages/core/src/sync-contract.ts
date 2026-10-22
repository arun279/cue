import { type TraktFailure, TraktReadError } from "./data/trakt/client";

export const UNDO_WINDOW_MS = 5000;

export const PENDING_GRACE_MS = 5000;

export const PENDING_THRESHOLD = 3;

function healsOnRetry(failure: TraktFailure): boolean {
  if (failure.kind === "network" || failure.kind === "timeout") return true;
  return failure.kind === "server" && failure.status >= 500;
}

export function readFailureOf(error: unknown): TraktFailure | null {
  return error instanceof TraktReadError ? error.failure : null;
}

// TanStack Query's retry receives the failure count before this failure.
export function shouldRetryRead(failureCount: number, error: unknown, attempts: number): boolean {
  const failure = readFailureOf(error);
  return failure !== null && healsOnRetry(failure) && failureCount + 1 < attempts;
}

export const SYNC_BANNER_KINDS = [
  "offline",
  "rate-limited",
  "retrying",
  "unreachable",
  "pending",
] as const;

type SyncBannerKind = (typeof SYNC_BANNER_KINDS)[number];

export interface SyncBanner {
  readonly kind: SyncBannerKind;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SyncBannerInput {
  readonly offline: boolean;
  readonly failure: TraktFailure | null;
  readonly retrying: boolean;
  readonly hasData: boolean;
  readonly resumeReadsAt: number;
  readonly pending: number;
  readonly pendingLate: boolean;
  readonly now: number;
}

function unreachableMessage(failure: TraktFailure): string {
  if (failure.kind === "network") return "Can't reach Trakt. Showing your cached data.";
  if (failure.kind === "timeout") return "Trakt didn't answer in time. Showing your cached data.";
  if (failure.kind === "server") {
    return "Trakt is having trouble. Showing your cached data.";
  }
  return "Couldn't refresh from Trakt. Showing your cached data.";
}

function rateLimitMessage(resumeAt: number, now: number): string {
  return `Trakt is limiting requests. Retrying in ${Math.ceil((resumeAt - now) / 1000)}s.`;
}

export function syncBanner(input: SyncBannerInput): SyncBanner | null {
  if (input.offline) {
    return { kind: "offline", message: "Offline. Your marks are saved.", retryable: false };
  }
  if (input.resumeReadsAt > input.now) {
    return {
      kind: "rate-limited",
      message: rateLimitMessage(input.resumeReadsAt, input.now),
      retryable: false,
    };
  }
  if (input.failure !== null && input.hasData) {
    if (input.retrying) {
      return {
        kind: "retrying",
        message: "Couldn't refresh from Trakt. Retrying…",
        retryable: false,
      };
    }
    return { kind: "unreachable", message: unreachableMessage(input.failure), retryable: true };
  }
  if (input.pendingLate && input.pending >= PENDING_THRESHOLD) {
    return {
      kind: "pending",
      message: `${input.pending} marks pending · will sync`,
      retryable: false,
    };
  }
  return null;
}

const TRY_AGAIN = "Try again in a moment.";
const TROUBLE = "Trakt is having trouble. Try again in a moment.";
const READ_FAILURE_BODY: Readonly<Record<TraktFailure["kind"], string>> = {
  "rate-limited": "Trakt is limiting requests. Cue will try again shortly.",
  network: "Check your connection and try again.",
  timeout: "Trakt didn't answer in time.",
  "unexpected-shape": "Trakt sent data in a shape this version doesn't read.",
  "no-content": "Trakt sent an empty reply.",
  server: TROUBLE,
  unauthorized: "Your Trakt session needs to reconnect.",
  "account-limit": "Your Trakt account has reached its limit.",
  "account-locked": "Your Trakt account is locked.",
  "vip-required": "This requires Trakt VIP.",
  "not-found": TRY_AGAIN,
};

export function readFailureBody(failure: TraktFailure | null): string {
  return failure === null ? TRY_AGAIN : READ_FAILURE_BODY[failure.kind];
}

type MarkControlState = "unwatched" | "just-marked" | "advancing";

export interface MarkControlView {
  readonly state: MarkControlState;
  readonly pending: boolean;
  readonly label: string;
}

export interface MarkControlInput {
  readonly markedAt: number | null;
  readonly pendingAdvance: boolean;
  readonly title: string;
  readonly episodeCode: string;
  readonly now: number;
}

export function resolveMarkControl(input: MarkControlInput): MarkControlView {
  const { markedAt, now } = input;
  if (markedAt !== null && now - markedAt < UNDO_WINDOW_MS) {
    return { state: "just-marked", pending: false, label: "Watched. Tap to remove." };
  }
  if (input.pendingAdvance) {
    const pending = markedAt !== null;
    return {
      state: "advancing",
      pending,
      label: pending ? "Watched. Not synced yet." : "Watched.",
    };
  }
  return {
    state: "unwatched",
    pending: false,
    label: `Mark ${input.title} ${input.episodeCode} watched`,
  };
}

export function markControlTickMs(markedAt: number | null, now: number): number | null {
  if (markedAt === null) return null;
  const remaining = markedAt + UNDO_WINDOW_MS - now;
  return remaining > 0 ? remaining : null;
}

export function markRecordRetireMs(
  markedAt: number,
  pendingAdvance: boolean,
  now: number,
): number | null {
  if (pendingAdvance) return null;
  return Math.max(0, markedAt + UNDO_WINDOW_MS - now);
}

interface Stamped {
  readonly at: number;
}

export function appendToBatch<T extends Stamped>(batch: readonly T[], entry: T): readonly T[] {
  const last = batch[batch.length - 1];
  if (last !== undefined && entry.at - last.at > UNDO_WINDOW_MS) return [entry];
  return [...batch, entry];
}
