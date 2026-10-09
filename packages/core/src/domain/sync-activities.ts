type ActivityStamps = { readonly [field: string]: string | undefined };

export interface LastActivities {
  readonly all?: string;
  readonly episodes?: ActivityStamps;
  readonly shows?: ActivityStamps;
  readonly movies?: ActivityStamps;
  readonly watchlist?: ActivityStamps;
  readonly seasons?: ActivityStamps;
  readonly lists?: ActivityStamps;
  readonly account?: ActivityStamps;
  readonly collaborations?: ActivityStamps;
}

export type InvalidationTarget =
  | "watched/shows"
  | "watched/movies"
  | "progress/watched"
  | "movie-progress"
  | "watchlist/shows"
  | "watchlist/movies"
  | "watchlist/episodes"
  | "hidden/progress_watched"
  | "hidden/movies"
  | "favorites/shows"
  | "favorites/movies"
  | "recompute:buckets"
  | "recompute:following"
  | "recompute:to-watch";

type ActivitySection = Exclude<keyof LastActivities, "all">;

interface ActivityRule {
  readonly section: ActivitySection;
  readonly field: string;
  readonly targets: readonly InvalidationTarget[];
}

const ACTIVITY_RULES: readonly ActivityRule[] = [
  { section: "episodes", field: "watched_at", targets: ["watched/shows", "progress/watched"] },
  { section: "episodes", field: "watchlisted_at", targets: ["watchlist/episodes"] },
  {
    section: "shows",
    field: "hidden_at",
    targets: ["hidden/progress_watched", "recompute:buckets"],
  },
  {
    section: "shows",
    field: "watchlisted_at",
    targets: ["watchlist/shows", "recompute:following", "recompute:to-watch"],
  },
  { section: "shows", field: "favorited_at", targets: ["favorites/shows"] },
  { section: "movies", field: "watched_at", targets: ["watched/movies", "movie-progress"] },
  {
    section: "movies",
    field: "watchlisted_at",
    targets: ["watchlist/movies", "recompute:following"],
  },
  { section: "movies", field: "hidden_at", targets: ["hidden/movies", "recompute:buckets"] },
  { section: "movies", field: "favorited_at", targets: ["favorites/movies"] },
  { section: "watchlist", field: "updated_at", targets: ["watchlist/shows", "watchlist/movies"] },
];

function advanced(before: string | undefined, after: string | undefined): boolean {
  if (after === undefined) return false;
  if (before === undefined) return true;
  const a = Date.parse(after);
  const b = Date.parse(before);
  if (Number.isNaN(a) || Number.isNaN(b)) return after !== before;
  return a > b;
}

export function diffActivities(
  stored: LastActivities | undefined,
  fresh: LastActivities,
): InvalidationTarget[] {
  const result = new Set<InvalidationTarget>();
  for (const rule of ACTIVITY_RULES) {
    const before = stored?.[rule.section]?.[rule.field];
    const after = fresh[rule.section]?.[rule.field];
    if (advanced(before, after)) {
      for (const target of rule.targets) result.add(target);
    }
  }
  return [...result];
}
