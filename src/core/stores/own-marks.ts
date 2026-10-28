import type { EpisodeDetail } from "../domain/episode-detail";
import { advancePastNext, type LibraryEntry } from "../domain/model/library";
import { patchEpisodes, type SeasonView } from "../domain/show-detail";

export interface OwnMark {
  readonly preCompleted: number;
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
}

const ownMarks = new Map<number, OwnMark>();

export function keepOwnMark(showId: number, mark: OwnMark): void {
  ownMarks.set(showId, mark);
}

export function forgetOwnMark(showId: number): void {
  ownMarks.delete(showId);
}

export function resetOwnMarks(): void {
  ownMarks.clear();
}

function behind(showId: number, completed: number): OwnMark | undefined {
  const mark = ownMarks.get(showId);
  if (mark !== undefined && completed > mark.preCompleted) ownMarks.delete(showId);
  return ownMarks.get(showId);
}

export function isBehindOwnMark(showId: number, completed: number): boolean {
  return behind(showId, completed) !== undefined;
}

export function withOwnMarks(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.map((entry) => {
    const mark = behind(entry.showId, entry.completed);
    return mark === undefined ? entry : advancePastNext(entry, mark.watchedAt);
  });
}

export function seasonsWithOwnMark(
  showId: number,
  seasons: readonly SeasonView[],
): readonly SeasonView[] {
  const mark = ownMarks.get(showId);
  return mark === undefined
    ? seasons
    : patchEpisodes(
        seasons,
        (season, number) => season === mark.season && number === mark.number,
        true,
      );
}

export function episodeWithOwnMark(detail: EpisodeDetail): EpisodeDetail {
  const mark = ownMarks.get(detail.showId);
  if (mark === undefined || detail.watched) return detail;
  return mark.season === detail.season && mark.number === detail.number
    ? { ...detail, watched: true, watchedAt: mark.watchedAt }
    : detail;
}
