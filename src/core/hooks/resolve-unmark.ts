import {
  type EpisodePlay,
  type MoviePlay,
  planEpisodeUnmark,
  type UnmarkPlan,
} from "../domain/reversal";
import { replacedPlays } from "../domain/write-queue/receipt";
import type { CueRuntime } from "../runtime/runtime";
import { usePlayPolicy } from "../stores/play-policy-store";

export type EpisodeUnmarkResolution =
  | { readonly kind: "remove"; readonly plan: UnmarkPlan }
  | {
      readonly kind: "rewatch";
      readonly count: number;
      readonly latest: EpisodePlay;
      readonly previous: EpisodePlay;
    }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

// Trakt history ids are monotonic, so a higher id is a later entry.
function newestFirst(a: EpisodePlay, b: EpisodePlay): number {
  const at = Date.parse(b.watchedAt) - Date.parse(a.watchedAt);
  return at !== 0 ? at : b.historyId - a.historyId;
}

export async function resolveEpisodeUnmark(
  runtime: CueRuntime,
  episodeTrakt: number,
): Promise<EpisodeUnmarkResolution> {
  let plays: readonly EpisodePlay[];
  try {
    plays = await runtime.loadEpisodePlays(episodeTrakt);
  } catch {
    return { kind: "error" };
  }
  const [latest, previous, ...older] = plays
    .filter((play) => play.episodeTrakt === episodeTrakt)
    .sort(newestFirst);
  if (latest !== undefined && previous !== undefined) {
    return { kind: "rewatch", count: older.length + 2, latest, previous };
  }
  const plan = planEpisodeUnmark(plays, episodeTrakt);
  return plan.removeIds.length === 0 ? { kind: "none" } : { kind: "remove", plan };
}

/** Whether a mark cannot have replaced an earlier play: the item had none, or the account keeps all. */
export const canRemoveOwnPlays = (priorPlay: boolean): boolean =>
  !priorPlay || usePlayPolicy.getState().policy === "multiple";

/**
 * Whether an Undo can take back marks that may be on Trakt: never one that replaced an earlier play,
 * and otherwise only when the plays at their minute are theirs alone or Trakt said it added them.
 */
export function takeBack(
  runtime: CueRuntime,
  opIds: readonly string[],
  priorPlay: boolean,
): "plays" | "replaced" | "unknown" {
  const receipts = opIds.map((id) => runtime.writeReceipt(id));
  if (receipts.some((receipt) => replacedPlays(receipt) > 0)) return "replaced";
  const added = receipts.every((receipt) => (receipt?.added ?? 0) > 0);
  return added || canRemoveOwnPlays(priorPlay) ? "plays" : "unknown";
}

export type MovieUnmarkResolution =
  | { readonly kind: "remove"; readonly historyId: number; readonly watchedAt: string }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

export async function resolveMovieUnmark(
  runtime: CueRuntime,
  movieId: number,
): Promise<MovieUnmarkResolution> {
  let plays: readonly MoviePlay[];
  try {
    plays = await runtime.loadMoviePlays(movieId);
  } catch {
    return { kind: "error" };
  }
  if (plays.length === 0) return { kind: "none" };
  if (plays.length >= 2) return { kind: "rewatch", count: plays.length };
  const play = plays[0] as MoviePlay;
  return { kind: "remove", historyId: play.historyId, watchedAt: play.watchedAt };
}

const SENT_POLL_MS = 200;
const SENT_POLL_TRIES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits, as long as an Undo can, until Trakt has answered each of these writes for good. */
export async function waitUntilSettled(
  runtime: CueRuntime,
  opIds: readonly string[],
): Promise<boolean> {
  const sending = (): boolean => opIds.some((id) => runtime.writeState(id) === "sent");
  if (sending()) void runtime.flushWrites();
  for (let attempt = 0; attempt < SENT_POLL_TRIES; attempt += 1) {
    if (!sending()) return true;
    await sleep(SENT_POLL_MS);
  }
  return false;
}
