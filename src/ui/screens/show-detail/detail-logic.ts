import type { SeasonView } from "@data/trakt/show-detail";
import type { MovieIds, ShowIds } from "@domain/model/ids";
import type { EpisodeBound } from "@ui/hooks/useMarkSeason";

/** Presentation + planning helpers for the detail surfaces, kept pure for tests. */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Join the truthy fragments with the quiet ` · ` separator. */
export function metaLine(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== null && part !== undefined && part !== "")
    .join(" · ");
}

/** The micro date chip that replaces an unaired episode's check: `Jul 16` (UTC,
 * matching the air-date formatter's broadcast-fact semantics); `TBA` unknown. */
export function monthDayChip(iso: string | null): string {
  if (iso === null) return "TBA";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBA";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

interface NextEpisodeLike {
  readonly season: number;
  readonly aired: boolean;
  readonly firstAired: string | null;
}

/** Which continue-bar body a show earns (§3.3.2). */
export type ContinueKind =
  | { readonly kind: "next" }
  | { readonly kind: "returning"; readonly season: number; readonly date: string }
  | { readonly kind: "finished" }
  | { readonly kind: "caught-up" };

export function continueKind(
  next: NextEpisodeLike | null,
  status: string,
  aired: number,
  completed: number,
): ContinueKind {
  if (next?.aired) return { kind: "next" };
  if (next !== null && next.firstAired !== null) {
    return { kind: "returning", season: next.season, date: next.firstAired };
  }
  const over = /ended|canceled/i.test(status);
  if (over && aired > 0 && completed >= aired) return { kind: "finished" };
  return { kind: "caught-up" };
}

/** Aired-but-unwatched episodes across the show (specials only when opted in):
 * the count "Mark whole show watched…" states and marks. */
export function airedUnwatchedCount(
  seasons: readonly SeasonView[],
  includeSpecials = false,
): number {
  let count = 0;
  for (const season of seasons) {
    if (season.number === 0 && !includeSpecials) continue;
    for (const episode of season.episodes) {
      if (episode.aired && !episode.watched) count += 1;
    }
  }
  return count;
}

/** The show's last aired regular episode: the bound a whole-show mark runs to. */
export function lastAiredBound(seasons: readonly SeasonView[]): EpisodeBound | null {
  let bound: EpisodeBound | null = null;
  for (const season of seasons) {
    if (season.number === 0) continue;
    for (const episode of season.episodes) {
      if (!episode.aired) continue;
      if (
        bound === null ||
        episode.season > bound.season ||
        (episode.season === bound.season && episode.number > bound.number)
      ) {
        bound = { season: episode.season, number: episode.number };
      }
    }
  }
  return bound;
}

/** Aired, unwatched regular episodes strictly BEFORE the bound: the "+N earlier"
 * backfill count. Specials are skipped (their ordering is not chronological), and
 * a bound inside Specials never offers a backfill at all. */
export function earlierUnwatchedCount(seasons: readonly SeasonView[], bound: EpisodeBound): number {
  if (bound.season === 0) return 0;
  let count = 0;
  for (const season of seasons) {
    if (season.number === 0) continue;
    for (const episode of season.episodes) {
      if (!episode.aired || episode.watched) continue;
      if (
        episode.season < bound.season ||
        (episode.season === bound.season && episode.number < bound.number)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** The post-backfill snackbar message (§4.3): `S2 E1–E5 marked` when the gap sits
 * inside the bound's season, else the honest coalesced count. */
export function backfillRangeLabel(
  seasons: readonly SeasonView[],
  bound: EpisodeBound,
  gapCount: number,
): string {
  let first: number | null = null;
  let crossSeason = false;
  for (const season of seasons) {
    if (season.number === 0) continue;
    for (const episode of season.episodes) {
      if (!episode.aired || episode.watched) continue;
      if (episode.season < bound.season) crossSeason = true;
      if (episode.season === bound.season && episode.number < bound.number) {
        first = first === null ? episode.number : Math.min(first, episode.number);
      }
    }
  }
  if (crossSeason || first === null) return `${gapCount + 1} episodes marked`;
  return `S${bound.season} E${first}–E${bound.number} marked`;
}

/** The accordion panel to auto-expand: the next episode's season, else the first
 * season with unwatched aired episodes, else the last season. */
export function currentSeasonValue(
  seasons: readonly SeasonView[],
  next: { readonly season: number } | null,
): string | undefined {
  if (seasons.length === 0) return undefined;
  if (next !== null && seasons.some((s) => s.number === next.season)) {
    return `s${next.season}`;
  }
  const incomplete = seasons.find(
    (s) => s.number !== 0 && s.episodes.some((e) => e.aired && !e.watched),
  );
  const fallback = seasons[seasons.length - 1];
  return `s${(incomplete ?? fallback)?.number ?? 0}`;
}

/** `You've watched 38 of 60 · 41 hr` — hours only when the runtime is known. */
export function watchRecordLine(
  completed: number,
  aired: number,
  runtimeMinutes: number | null,
): string | null {
  if (completed <= 0) return null;
  const base = `You've watched ${completed} of ${aired}`;
  if (runtimeMinutes === null || runtimeMinutes <= 0) return base;
  const hours = Math.round((completed * runtimeMinutes) / 60);
  return hours > 0 ? `${base} · ${hours} hr` : base;
}

export function traktShowUrl(ids: ShowIds): string {
  return `https://trakt.tv/shows/${ids.slug ?? ids.trakt}`;
}

export function traktEpisodeUrl(showIds: ShowIds, episode: EpisodeBound): string {
  return `${traktShowUrl(showIds)}/seasons/${episode.season}/episodes/${episode.number}`;
}

export function traktMovieUrl(ids: MovieIds): string {
  return `https://trakt.tv/movies/${ids.slug ?? ids.trakt}`;
}

/** Open an external hand-off in a new browsing context, never the app's own. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Season-check rendering facts, clamped to the aired basis (a watched unaired
 * special can never read the season complete). */
export function seasonCheckFacts(season: SeasonView): {
  readonly airedDone: number;
  readonly complete: boolean;
  readonly partial: boolean;
} {
  const airedDone = Math.min(season.completedCount, season.airedCount);
  const complete = season.airedCount > 0 && airedDone >= season.airedCount;
  return { airedDone, complete, partial: !complete && airedDone > 0 };
}
