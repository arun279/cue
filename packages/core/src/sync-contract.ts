/**
 * What the app says while sync is not clean, in one place.
 *
 * Both targets render the same states from the same inputs: the ambient strip a
 * screen puts under its header, the body copy a screen with nothing cached
 * shows instead of content, the grammar of a queue mark control, and the timing
 * that moves between them. It is pure, so a screen cannot invent its own
 * message and the two apps cannot drift apart on what a rate limit is called.
 *
 * The rules it encodes:
 *   - A rate limit is not an outage. It says so, says when it retries, and
 *     offers no Retry button, because the retry is automatic.
 *   - A failed refresh over cached content is a note, never the screen's error:
 *     the content stays and the strip carries the failure.
 *   - A mark advances its row on the clock, never on a round trip. The durable
 *     queue guarantees delivery, so the row does not wait for it.
 *   - Green means take-back-able. Once the undo window closes the row is
 *     advanced, and outstanding delivery is a quiet indicator, not a green check.
 */

import { type TraktFailure, TraktReadError } from "./data/trakt/client";

/**
 * How long a mark stays take-back-able: the snackbar's Undo and the row's green
 * check are the same affordance and must appear and retract together, so they
 * share one number. Marks landing inside it coalesce into one batch.
 */
export const UNDO_WINDOW_MS = 5000;

/**
 * How long a backlog of writes stays quiet before the strip mentions it. A burst
 * on a healthy connection drains inside it, so the user is never told about work
 * that was never a problem.
 */
export const PENDING_GRACE_MS = 5000;

/** Pending marks before the strip carries a backlog line at all. */
export const PENDING_THRESHOLD = 3;

/**
 * Attempts a single read gets from the query layer before the app stops on its
 * own. Three (the call plus two retries) rides out a transport blip in a few
 * seconds; past that the failure is real enough to show, with a Retry.
 */
const MAX_READ_ATTEMPTS = 3;

/**
 * Failures the QUERY layer retries: the proxy will recover, the socket will
 * connect, and nothing else is retrying them. A rate limit is deliberately
 * absent. The read pool already retries a 429 on Trakt's own `Retry-After` and
 * holds every other read behind the pause it opens, so one 429 is one bounded
 * ladder there; retrying it here as well would re-run a whole aggregate read
 * into a window the app already knows is closed, and multiply the very traffic
 * the limit is asking it to reduce. The pool is also the only layer over the
 * write queue's reconcile reads, so it is the one that has to own this. A 4xx
 * that is not a rate limit will not heal, so retrying it only delays the truth;
 * `server` carries its status because the client folds every non-2xx it does not
 * model into it.
 */
function healsOnRetry(failure: TraktFailure): boolean {
  if (failure.kind === "network") return true;
  return failure.kind === "server" && failure.status >= 500;
}

/** The typed failure behind a thrown read, or null for anything else (a schema throw). */
export function readFailureOf(error: unknown): TraktFailure | null {
  return error instanceof TraktReadError ? error.failure : null;
}

/** TanStack `retry`: `failureCount` is the count BEFORE this failure is counted. */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  const failure = readFailureOf(error);
  return failure !== null && healsOnRetry(failure) && failureCount + 1 < MAX_READ_ATTEMPTS;
}

/**
 * Every kind the strip can carry. An array rather than a bare union so a target
 * can enumerate them: the web stylesheet is checked against this, which is what
 * a renamed kind used to slip past silently.
 */
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
  /** Whether to offer a manual retry. Only a failure the app has stopped chasing has one. */
  readonly retryable: boolean;
}

export interface SyncBannerInput {
  readonly offline: boolean;
  /** The screen's change-driven read: what failed, live or settled. */
  readonly failure: TraktFailure | null;
  /** The read is trying again, so the failure is not final and there is nothing to retry. */
  readonly retrying: boolean;
  /** The screen has content to keep showing. */
  readonly hasData: boolean;
  /** Epoch ms the shared read pause lifts; at or before `now` means reads run. */
  readonly resumeReadsAt: number;
  /** Durable writes still awaiting Trakt. */
  readonly pending: number;
  /** The oldest of them has been outstanding past {@link PENDING_GRACE_MS}. */
  readonly pendingLate: boolean;
  readonly now: number;
}

function unreachableMessage(failure: TraktFailure): string {
  if (failure.kind === "network") return "Can't reach Trakt. Showing your cached data.";
  if (failure.kind === "server") return "Trakt is having trouble. Showing your cached data.";
  // A rate limit whose window has since reopened lands here: the read gave up
  // inside it, so what is true now is that the refresh did not happen.
  return "Couldn't refresh from Trakt. Showing your cached data.";
}

function rateLimitMessage(resumeAt: number, now: number): string {
  const seconds = Math.ceil((resumeAt - now) / 1000);
  const when = seconds > 0 ? `Retrying in ${seconds}s.` : "Retrying now.";
  return `Trakt is limiting requests. ${when}`;
}

/**
 * The ambient strip, in priority order: an offline device fails every read, so
 * saying so first is the only honest line; a rate limit explains a stalled read
 * AND a stalled write, so it outranks both; a read still trying comes next,
 * then a failure the app has given up on; a backlog last. Null means silence,
 * which is what healthy looks like.
 *
 * A read failure with nothing cached is deliberately absent: the screen shows
 * its own error state there, and a strip claiming to show cached data over an
 * empty screen is the lie this contract exists to remove.
 */
export function syncBanner(input: SyncBannerInput): SyncBanner | null {
  if (input.offline) {
    return { kind: "offline", message: "Offline. Your marks are saved.", retryable: false };
  }
  // The LIVE pause, not the last failure: while it stands, every read the pool
  // issues waits it out, so "retrying in Ns" is true of the app whatever any one
  // query is doing. Once it lifts, a read that still has not landed has given
  // up, and the honest line is the one below with a Retry on it.
  if (input.resumeReadsAt > input.now) {
    return {
      kind: "rate-limited",
      message: rateLimitMessage(input.resumeReadsAt, input.now),
      retryable: false,
    };
  }
  if (input.failure !== null && input.hasData) {
    // A blip the app is still chasing is not an outage. Naming one on the first
    // failed attempt is what put "Can't reach Trakt" over live data and then
    // took it away again a few seconds later; until the retries are spent, the
    // true and quiet thing to say is that a refresh is being tried again.
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

/**
 * What a screen with nothing cached says under its "Couldn't load" title. The
 * default covers a schema throw and every failure that is nobody's connection.
 */
export function readFailureBody(failure: TraktFailure | null): string {
  switch (failure?.kind) {
    case "rate-limited":
      return "Trakt is limiting requests. Cue will try again shortly.";
    case "network":
      return "Check your connection and try again.";
    case "server":
      return "Trakt is having trouble. Try again in a moment.";
    case "unauthorized":
      return "Your Trakt session needs to reconnect.";
    default:
      return "Try again in a moment.";
  }
}

/**
 * The queue grammar's three states. `advancing` is the row that has moved on
 * while its next episode is still a client projection: quiet and inert, because
 * marking a guessed coordinate is forbidden, and never green, because the mark
 * it is waiting on is no longer take-back-able.
 */
type MarkControlState = "unwatched" | "just-marked" | "advancing";

export interface MarkControlView {
  readonly state: MarkControlState;
  /** The mark is past its undo window and Trakt has yet to confirm it: the quiet
   * indicator. The undo window IS the threshold, because up to it the honest
   * thing to say is "you can still take this back", and past it "this is saved
   * and on its way". A mark confirmed inside the window never shows it. */
  readonly pending: boolean;
  readonly label: string;
}

export interface MarkControlInput {
  /** Epoch ms of the tap that opened this show's window, or null. */
  readonly markedAt: number | null;
  /** The row's next episode is a post-mark projection, not Trakt's answer. */
  readonly pendingAdvance: boolean;
  readonly title: string;
  /** "S2 E11" for the episode a tap would mark; empty when there is none. */
  readonly episodeCode: string;
  readonly now: number;
}

/**
 * Resolve one row's mark control. Green for the undo window and no longer,
 * measured from the tap: the row advances on the clock, so a rate-limited or
 * offline queue can never leave it looking marked-and-stuck.
 */
export function resolveMarkControl(input: MarkControlInput): MarkControlView {
  const { markedAt, now } = input;
  if (markedAt !== null && now - markedAt < UNDO_WINDOW_MS) {
    return { state: "just-marked", pending: false, label: "Watched. Tap to remove." };
  }
  if (input.pendingAdvance) {
    // A row advancing with no record of its own tap was marked elsewhere, or
    // remounted after one: there is nothing outstanding here to report.
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

/**
 * Ms until the control's one scheduled state change, the close of the undo
 * window, so a row re-renders on the clock rather than on a response. Null when
 * there is nothing left to wait for.
 */
export function markControlTickMs(markedAt: number | null, now: number): number | null {
  if (markedAt === null) return null;
  const remaining = markedAt + UNDO_WINDOW_MS - now;
  return remaining > 0 ? remaining : null;
}

/**
 * How long until a just-marked show's record may be retired: never while its
 * authoritative next episode is still outstanding (the row would re-arm on a
 * guessed coordinate), and never before the undo window has run.
 */
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

/**
 * Append a mark to the rolling snackbar batch: inside the undo window it joins
 * the existing batch, whose Undo reverses all of them; past it the batch has
 * left the screen, so the mark starts a fresh one.
 */
export function appendToBatch<T extends Stamped>(batch: readonly T[], entry: T): readonly T[] {
  const last = batch[batch.length - 1];
  if (last !== undefined && entry.at - last.at > UNDO_WINDOW_MS) return [entry];
  return [...batch, entry];
}
