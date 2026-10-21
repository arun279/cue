/**
 * A synthetic account at the scale and shape of a long-time Trakt user, for the
 * performance probe: about 110 shows with plays, 100 of them in progress and more
 * than 50 idle long enough to sit under "Haven't watched lately", about 950 plays,
 * 340 watchlist titles and 150 collected ones, with long titles and titles Trakt
 * has no artwork for. Every title and number here is generated.
 */

const IN_PROGRESS = 100;
const FINISHED = 9;
const LAPSED_EVERY = 2;
const WATCHED_MOVIES = 60;

const LONG = "The Extraordinarily Long and Winding Chronicles of the Northern Lighthouse Keepers";

const title = (kind, index) =>
  index % 7 === 3 ? `${LONG}, Part ${index}` : `${kind} ${String(index).padStart(3, "0")}`;

/**
 * Shows with plays. Every other one has been idle for months, the rest were watched in the
 * last three weeks, and both groups sort after the default account's shows so the probe's
 * flows find the rows they tap at the top of each list.
 */
export const SCALE_SHOWS = Array.from({ length: IN_PROGRESS + FINISHED }, (_, index) => {
  const finished = index >= IN_PROGRESS;
  const seasons = [10, 10, 8];
  const aired = seasons.reduce((sum, count) => sum + count, 0);
  const lapsed = !finished && index % LAPSED_EVERY === 0;
  return {
    trakt: 9000 + index,
    tmdb: 99000 + index,
    slug: `scale-show-${index}`,
    title: title("Scale Show", index),
    year: 2005 + (index % 20),
    status: finished || index % 5 === 0 ? "ended" : "returning series",
    network: "Meridian",
    runtime: 30 + (index % 4) * 10,
    genres: ["drama"],
    overview: "A generated show the probe account is partway through.",
    seasons,
    startDaysAgo: aired * 7 + 30,
    completed: finished ? aired : 2 + (index % 8),
    lastWatchedDaysAgo: lapsed ? 150 + index : 4 + (index % 14),
    noArt: index % 9 === 4,
    collectedDaysAgo: index % 3 === 0 ? 200 + index : undefined,
  };
});

export const SCALE_MOVIES = Array.from({ length: WATCHED_MOVIES }, (_, index) => ({
  trakt: 6800 + index,
  tmdb: 96800 + index,
  slug: `scale-movie-${index}`,
  title: title("Scale Movie", index),
  year: 1995 + (index % 30),
  released: `${1995 + (index % 30)}-03-01`,
  runtime: 95 + (index % 5) * 10,
  genres: ["drama"],
  overview: "A generated film the probe account has watched.",
  lastWatchedDaysAgo: 2 + index * 5,
  noArt: index % 11 === 6,
  collectedDaysAgo: index % 5 === 0 ? 300 + index : undefined,
}));

/** How many of the collection's never-started titles move to the watchlist instead. */
export const SCALE_WATCHLIST = { shows: 240, movies: 100 };
