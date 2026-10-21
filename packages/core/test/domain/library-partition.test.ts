import { assembleLibrary } from "@cue/core/data/trakt/library";
import { assembleMovieLibrary } from "@cue/core/data/trakt/movie-library";
import type {
  CollectionMovie,
  CollectionShow,
  Progress,
  WatchedMovie,
  WatchedShow,
  WatchlistItem,
} from "@cue/core/data/trakt/schemas";
import { chipBuckets, movieBuckets } from "@cue/core/domain/library-buckets";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAY, iso, NOW, THRESHOLD } from "./_helpers";

const id = fc.integer({ min: 1, max: 40 });
const ids = fc.uniqueArray(id, { maxLength: 30 });
const stamp = fc.option(fc.integer({ min: NOW - 400 * DAY, max: NOW }).map(iso), {
  nil: undefined,
});
const ref = (trakt: number) => ({ title: `Title ${trakt}`, ids: { trakt } });

const watchedShow = fc.record({
  trakt: id,
  aired: fc.integer({ min: 0, max: 12 }),
  watched: fc.integer({ min: 0, max: 12 }),
  at: stamp,
  status: fc.constantFrom("returning series", "ended", "canceled"),
});

const showInput = fc.record({
  watched: fc.uniqueArray(watchedShow, { selector: (show) => show.trakt, maxLength: 25 }),
  progressFor: ids,
  completed: fc.integer({ min: 0, max: 12 }),
  watchlist: fc.array(fc.record({ trakt: id, at: stamp }), { maxLength: 25 }),
  collection: fc.array(fc.record({ trakt: id, at: stamp }), { maxLength: 25 }),
  hidden: ids,
});

const movieInput = fc.record({
  watched: fc.uniqueArray(fc.record({ trakt: id, at: stamp }), {
    selector: (movie) => movie.trakt,
    maxLength: 25,
  }),
  watchlist: fc.array(fc.record({ trakt: id, at: stamp }), { maxLength: 25 }),
  collection: fc.array(fc.record({ trakt: id, at: stamp }), { maxLength: 25 }),
});

describe("the library chips partition the library", () => {
  it("puts every show from the watched list, the watchlist and the collection under exactly one chip", () => {
    fc.assert(
      fc.property(showInput, (input) => {
        const watchedShows: WatchedShow[] = input.watched.map((show) => ({
          last_watched_at: show.at,
          show: { ...ref(show.trakt), status: show.status, aired_episodes: show.aired },
          seasons: [
            {
              number: 1,
              episodes: Array.from({ length: show.watched }, (_, i) => ({ number: i + 1 })),
            },
          ],
        }));
        const progress = new Map<number, Progress>(
          input.progressFor.map((trakt) => [
            trakt,
            { aired: 12, completed: input.completed, next_episode: null },
          ]),
        );
        const watchlistShows: WatchlistItem[] = input.watchlist.map((item) => ({
          type: "show",
          listed_at: item.at,
          show: ref(item.trakt),
        }));
        const collectionShows: CollectionShow[] = input.collection.map((item) => ({
          last_collected_at: item.at,
          show: ref(item.trakt),
        }));
        const entries = assembleLibrary({
          watchedShows,
          progress,
          hiddenShowIds: new Set(input.hidden),
          watchlistShows,
          collectionShows,
        });
        const chips = chipBuckets(entries, NOW, THRESHOLD);

        const titles = new Set([
          ...input.watched.map((show) => show.trakt),
          ...input.watchlist.map((item) => item.trakt),
          ...input.collection.map((item) => item.trakt),
        ]);
        const placed = Object.values(chips).flatMap((chip) => chip.map((entry) => entry.showId));
        expect(placed.length).toBe(titles.size);
        expect(new Set(placed)).toEqual(titles);

        const watchedIds = new Set(input.watched.map((show) => show.trakt));
        const hidden = new Set(input.hidden);
        const neverPlayed = [...titles].filter(
          (trakt) => !watchedIds.has(trakt) && !hidden.has(trakt),
        );
        const notStarted = new Set(chips["not-started"].map((entry) => entry.showId));
        for (const trakt of neverPlayed) expect(notStarted.has(trakt)).toBe(true);
        for (const entry of chips["not-started"]) expect(entry.completed).toBe(0);
      }),
    );
  });

  it("puts every movie under exactly one chip, and Not started holds exactly the unplayed ones", () => {
    fc.assert(
      fc.property(movieInput, (input) => {
        const watchedMovies: WatchedMovie[] = input.watched.map((movie) => ({
          last_watched_at: movie.at,
          movie: ref(movie.trakt),
        }));
        const watchlistMovies: WatchlistItem[] = input.watchlist.map((item) => ({
          type: "movie",
          listed_at: item.at,
          movie: ref(item.trakt),
        }));
        const collectionMovies: CollectionMovie[] = input.collection.map((item) => ({
          collected_at: item.at,
          movie: ref(item.trakt),
        }));
        const buckets = movieBuckets(
          assembleMovieLibrary({ watchedMovies, watchlistMovies, collectionMovies }),
        );

        const watchedIds = new Set(input.watched.map((movie) => movie.trakt));
        const titles = new Set([
          ...watchedIds,
          ...input.watchlist.map((item) => item.trakt),
          ...input.collection.map((item) => item.trakt),
        ]);
        const notStarted = buckets["not-started"].map((entry) => entry.movieId);
        const watched = buckets.watched.map((entry) => entry.movieId);
        expect(notStarted.length + watched.length).toBe(titles.size);
        expect(new Set([...notStarted, ...watched])).toEqual(titles);
        expect(new Set(notStarted)).toEqual(
          new Set([...titles].filter((trakt) => !watchedIds.has(trakt))),
        );
      }),
    );
  });
});
