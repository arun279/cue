import { z } from "zod";

/**
 * Zod contracts for the Trakt bodies the app reads. Only the
 * fields the domain consumes are validated; Trakt's many extras are stripped.
 * A wrong-shape (or non-JSON → `null`) body fails `.parse`: the "malformed
 * body throws" guarantee lives here, not in the transport.
 */

const idsSchema = z.object({
  trakt: z.number(),
  slug: z.string().optional(),
  imdb: z.string().nullish(),
  tmdb: z.number().nullish(),
  tvdb: z.number().nullish(),
});

const imageListSchema = z.array(z.string());
const imagesSchema = z
  .object({
    poster: imageListSchema.optional(),
    fanart: imageListSchema.optional(),
    thumb: imageListSchema.optional(),
    screenshot: imageListSchema.optional(),
  })
  .optional();

const showSchema = z.object({
  title: z.string(),
  year: z.number().nullish(),
  status: z.string().optional(),
  ids: idsSchema,
  images: imagesSchema,
});

const movieSchema = z.object({
  title: z.string(),
  year: z.number().nullish(),
  ids: idsSchema,
  images: imagesSchema,
});

export const episodeSchema = z.object({
  season: z.number(),
  number: z.number(),
  title: z.string().nullish(),
  overview: z.string().nullish(),
  runtime: z.number().nullish(),
  first_aired: z.string().nullish(),
  ids: idsSchema,
  images: imagesSchema,
});

const watchedShowSchema = z.object({
  last_watched_at: z.string().nullish(),
  plays: z.number().optional(),
  show: showSchema,
  // The bulk `/sync/watched/shows` breakdown lists only WATCHED episodes per
  // season (Trakt returns it by default). It is the caught-up baseline for a show
  // whose per-show progress the bounded cold-sync fan-out did not
  // fetch: the watched-episode count without a second GET.
  seasons: z
    .array(z.object({ number: z.number(), episodes: z.array(z.object({ number: z.number() })) }))
    .optional(),
});
export const watchedShowsSchema = z.array(watchedShowSchema);

const watchedMovieSchema = z.object({
  last_watched_at: z.string().nullish(),
  plays: z.number().optional(),
  movie: movieSchema,
});
export const watchedMoviesSchema = z.array(watchedMovieSchema);

export const progressSchema = z.object({
  aired: z.number(),
  completed: z.number(),
  last_watched_at: z.string().nullish(),
  next_episode: episodeSchema.nullable(),
  seasons: z
    .array(
      z.object({
        number: z.number(),
        aired: z.number(),
        completed: z.number(),
        episodes: z.array(
          z.object({
            number: z.number(),
            completed: z.boolean(),
            last_watched_at: z.string().nullish(),
          }),
        ),
      }),
    )
    .optional(),
});

export const movieDetailSchema = z.object({
  title: z.string(),
  year: z.number().nullish(),
  overview: z.string().nullish(),
  runtime: z.number().nullish(),
  released: z.string().nullish(),
  genres: z.array(z.string()).nullish(),
  ids: idsSchema,
  images: imagesSchema,
});

export const showDetailSchema = z.object({
  title: z.string(),
  year: z.number().nullish(),
  status: z.string().optional(),
  overview: z.string().nullish(),
  network: z.string().nullish(),
  runtime: z.number().nullish(),
  genres: z.array(z.string()).nullish(),
  first_aired: z.string().nullish(),
  ids: idsSchema,
  images: imagesSchema,
});

export const seasonsSchema = z.array(
  z.object({
    number: z.number(),
    title: z.string().nullish(),
    images: imagesSchema,
    episodes: z.array(episodeSchema).optional(),
  }),
);

export const watchlistSchema = z.array(
  z.object({
    rank: z.number().optional(),
    listed_at: z.string().optional(),
    type: z.string(),
    show: showSchema.optional(),
    movie: movieSchema.optional(),
  }),
);

export const ratingsSchema = z.array(
  z.object({
    rated_at: z.string().optional(),
    rating: z.number(),
    type: z.string(),
    show: showSchema.optional(),
    movie: movieSchema.optional(),
    episode: episodeSchema.optional(),
  }),
);

export const calendarSchema = z.array(
  z.object({ first_aired: z.string(), episode: episodeSchema, show: showSchema }),
);

/**
 * `/users/me/history` rows. Each row is one *play*: `id` is the unique
 * Trakt history-event id (the per-play removal handle), `watched_at` is
 * minute-precision, and the row carries the show+episode or the movie. `action`
 * (scrobble/checkin/watch) and other extras are stripped: the Diary only reads
 * the item + when it was played.
 */
const historyItemSchema = z.object({
  id: z.number(),
  watched_at: z.string(),
  type: z.string(),
  episode: episodeSchema.optional(),
  show: showSchema.optional(),
  movie: movieSchema.optional(),
});
export const historySchema = z.array(historyItemSchema);

export const searchSchema = z.array(
  z.object({
    type: z.string(),
    score: z.number().nullish(),
    show: showSchema.optional(),
    movie: movieSchema.optional(),
  }),
);

/** `/shows/trending` rows wrap the show in a watcher count; `/shows/popular` is a bare show list. */
export const trendingShowsSchema = z.array(
  z.object({ watchers: z.number().nullish(), show: showSchema }),
);
export const popularShowsSchema = z.array(showSchema);

/** The movie discover rails, mirroring the show charts: `/movies/trending` wraps
 * the movie in a watcher count, `/movies/popular` is a bare movie list, and
 * `/movies/:id/related` returns a bare movie list ("more like this"). */
export const trendingMoviesSchema = z.array(
  z.object({ watchers: z.number().nullish(), movie: movieSchema }),
);
export const popularMoviesSchema = z.array(movieSchema);
export const relatedMoviesSchema = z.array(movieSchema);

export const hiddenSchema = z.array(
  z.object({
    hidden_at: z.string().optional(),
    type: z.string(),
    show: showSchema.optional(),
    movie: movieSchema.optional(),
  }),
);

/**
 * `/users/me/stats`, keeping only the sections the Profile theatre reads: the
 * distinct-item counts and the watch-time minutes. Trakt's `plays`, `collected`,
 * `ratings`, `network`, and rating-distribution extras are stripped by zod.
 */
export const userStatsSchema = z.object({
  movies: z.object({ watched: z.number(), minutes: z.number() }),
  episodes: z.object({ watched: z.number(), minutes: z.number() }),
  shows: z.object({ watched: z.number() }),
});

const stampsSchema = z.record(z.string(), z.string()).optional();
export const lastActivitiesSchema = z.object({
  all: z.string().optional(),
  episodes: stampsSchema,
  shows: stampsSchema,
  movies: stampsSchema,
  watchlist: stampsSchema,
  seasons: stampsSchema,
  lists: stampsSchema,
  account: stampsSchema,
  collaborations: stampsSchema,
});

export type EpisodeData = z.infer<typeof episodeSchema>;
export type WatchedShow = z.infer<typeof watchedShowSchema>;
export type WatchedMovie = z.infer<typeof watchedMovieSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type MovieDetailData = z.infer<typeof movieDetailSchema>;
export type ShowDetailData = z.infer<typeof showDetailSchema>;
export type SeasonData = z.infer<typeof seasonsSchema>[number];
export type WatchlistItem = z.infer<typeof watchlistSchema>[number];
export type RatingItem = z.infer<typeof ratingsSchema>[number];
export type CalendarItem = z.infer<typeof calendarSchema>[number];
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type SearchResult = z.infer<typeof searchSchema>[number];
export type ShowSummary = z.infer<typeof showSchema>;
export type MovieSummary = z.infer<typeof movieSchema>;
export type TrendingShow = z.infer<typeof trendingShowsSchema>[number];
export type TrendingMovie = z.infer<typeof trendingMoviesSchema>[number];
export type HiddenItem = z.infer<typeof hiddenSchema>[number];
export type UserStats = z.infer<typeof userStatsSchema>;
