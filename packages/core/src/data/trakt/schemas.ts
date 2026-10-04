import { z } from "zod";
import { list, nonEssential, num } from "./decode";

const str = z.string();
const idsSchema = z.object({
  trakt: num,
  slug: nonEssential(str),
  imdb: nonEssential(str.nullable()),
  tmdb: nonEssential(num.nullable()),
  tvdb: nonEssential(num.nullable()),
});

const imageListSchema = nonEssential(z.array(str));
const imagesSchema = nonEssential(
  z.object({
    poster: imageListSchema,
    fanart: imageListSchema,
    thumb: imageListSchema,
    screenshot: imageListSchema,
  }),
);

const showSchema = z.object({
  title: str,
  year: nonEssential(num.nullable()),
  status: nonEssential(str),
  ids: idsSchema,
  images: imagesSchema,
});

const movieSchema = z.object({
  title: str,
  year: nonEssential(num.nullable()),
  ids: idsSchema,
  images: imagesSchema,
});

export const episodeSchema = z.object({
  season: num,
  number: num,
  title: nonEssential(str.nullable()),
  overview: nonEssential(str.nullable()),
  runtime: nonEssential(num.nullable()),
  first_aired: nonEssential(str.nullable()),
  ids: idsSchema,
  images: imagesSchema,
});

const watchedShowSchema = z.object({
  last_watched_at: nonEssential(str.nullable()),
  plays: nonEssential(num),
  // After a Trakt "restart show", /progress/watched counts only plays after reset_at; the breakdown still lists all.
  reset_at: nonEssential(str.nullable()),
  show: showSchema.extend({ aired_episodes: num }),
  seasons: nonEssential(
    z.array(
      z.object({
        number: num,
        episodes: z.array(z.object({ number: num, last_watched_at: nonEssential(str.nullable()) })),
      }),
    ),
  ),
});
export const watchedShowsSchema = list(watchedShowSchema);

const watchedMovieSchema = z.object({
  last_watched_at: nonEssential(str.nullable()),
  plays: nonEssential(num),
  movie: movieSchema,
});
export const watchedMoviesSchema = list(watchedMovieSchema);

export const progressSchema = z.object({
  aired: num,
  completed: num,
  last_episode: nonEssential(episodeSchema.nullable()),
  next_episode: episodeSchema.nullable(),
  seasons: nonEssential(
    z.array(
      z.object({
        number: num,
        aired: num,
        completed: num,
        episodes: z.array(
          z.object({
            number: num,
            completed: z.boolean(),
            last_watched_at: nonEssential(str.nullable()),
          }),
        ),
      }),
    ),
  ),
});

export const movieDetailSchema = z.object({
  title: str,
  year: nonEssential(num.nullable()),
  overview: nonEssential(str.nullable()),
  runtime: nonEssential(num.nullable()),
  released: nonEssential(str.nullable()),
  genres: nonEssential(z.array(str).nullable()),
  ids: idsSchema,
  images: imagesSchema,
});

export const showDetailSchema = z.object({
  title: str,
  year: nonEssential(num.nullable()),
  status: nonEssential(str),
  overview: nonEssential(str.nullable()),
  network: nonEssential(str.nullable()),
  runtime: nonEssential(num.nullable()),
  genres: nonEssential(z.array(str).nullable()),
  first_aired: nonEssential(str.nullable()),
  ids: idsSchema,
  images: imagesSchema,
});

export const seasonsSchema = list(
  z.object({
    number: num,
    title: nonEssential(str.nullable()),
    episodes: nonEssential(list(episodeSchema)),
  }),
);

export const watchlistSchema = list(
  z.object({
    rank: nonEssential(num),
    listed_at: nonEssential(str),
    type: str,
    show: nonEssential(showSchema),
    movie: nonEssential(movieSchema),
  }),
);

const calendarShowSchema = showSchema.extend({ network: nonEssential(str.nullable()) });
export const calendarSchema = list(
  z.object({ first_aired: str, episode: episodeSchema, show: calendarShowSchema }),
);

const historyItemSchema = z.object({
  id: num,
  watched_at: str,
  type: str,
  episode: nonEssential(episodeSchema),
  show: nonEssential(showSchema),
  movie: nonEssential(movieSchema),
});
export const historySchema = list(historyItemSchema);

export const searchSchema = list(
  z.object({
    type: str,
    score: nonEssential(num.nullable()),
    show: nonEssential(showSchema),
    movie: nonEssential(movieSchema),
  }),
);

export const trendingShowsSchema = list(
  z.object({ watchers: nonEssential(num.nullable()), show: showSchema }),
);
export const popularShowsSchema = list(showSchema);

export const trendingMoviesSchema = list(
  z.object({ watchers: nonEssential(num.nullable()), movie: movieSchema }),
);
export const popularMoviesSchema = list(movieSchema);

export const hiddenSchema = list(
  z.object({
    hidden_at: nonEssential(str),
    type: str,
    show: nonEssential(showSchema),
    movie: nonEssential(movieSchema),
  }),
);

export const userStatsSchema = z.object({
  movies: nonEssential(z.object({ watched: nonEssential(num), minutes: nonEssential(num) })),
  episodes: nonEssential(z.object({ watched: nonEssential(num), minutes: nonEssential(num) })),
  shows: nonEssential(z.object({ watched: nonEssential(num) })),
});

export const userSettingsSchema = z.object({
  user: z.object({
    username: str,
    name: nonEssential(str.nullable()),
    images: nonEssential(
      z
        .object({
          avatar: nonEssential(z.object({ full: nonEssential(str.nullable()) }).nullable()),
        })
        .nullable(),
    ),
  }),
});

function keepStamps(stamps: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [field, at] of Object.entries(stamps)) if (typeof at === "string") kept[field] = at;
  return kept;
}
const stampsSchema = nonEssential(z.record(str, z.unknown()).transform(keepStamps));
export const lastActivitiesSchema = z.object({
  all: nonEssential(str),
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
export type CalendarItem = z.infer<typeof calendarSchema>[number];
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type SearchResult = z.infer<typeof searchSchema>[number];
export type ShowSummary = z.infer<typeof showSchema>;
export type MovieSummary = z.infer<typeof movieSchema>;
export type TrendingShow = z.infer<typeof trendingShowsSchema>[number];
export type TrendingMovie = z.infer<typeof trendingMoviesSchema>[number];
export type HiddenItem = z.infer<typeof hiddenSchema>[number];
export type UserStats = z.infer<typeof userStatsSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
