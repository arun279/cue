import { type EpisodePlay, planEpisodeUnmark, type UnmarkPlan } from "@domain/reversal";
import type { CueRuntime } from "@ui/runtime/runtime";

/**
 * The outcome of resolving a single-episode uncheck against its real Trakt plays
 * `remove` carries the per-play plan (safe id-scoped removal);
 * `rewatch` means the episode has more than one play, so a one-tap uncheck would
 * destroy watch history — the caller must refuse and route to the Diary; `none`
 * means the server already holds no play (nothing to remove); `error` means the
 * resolve read itself failed.
 */
export type EpisodeUnmarkResolution =
  | { readonly kind: "remove"; readonly plan: UnmarkPlan }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

/**
 * Resolve an episode's plays and decide how (or whether) to unmark it, so every
 * durable uncheck removes exact history ids and never wipes a rewatch. Shared by
 * the show-detail season row and the episode-detail toggle so the two surfaces
 * behave identically.
 */
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
  const plan = planEpisodeUnmark(plays, episodeTrakt);
  if (plan.keptRewatch.length > 0) return { kind: "rewatch", count: plays.length };
  if (plan.removeIds.length === 0) return { kind: "none" };
  return { kind: "remove", plan };
}
