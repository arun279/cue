import * as S from "@cue/core/data/trakt/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { FIXTURE_NOW } from "../../../../scripts/mock-trakt/seed.mjs";
import { createMockTrakt } from "../../../../scripts/mock-trakt/server.mjs";
import {
  type EndpointShape,
  type Observed,
  observe,
  type PathShape,
  parentOf,
  pathsTheAppReads,
  REAL,
  type Summary,
  sameClass,
  templateOf,
} from "./trakt-shape";

const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "GET /sync/watched/shows": S.watchedShowsSchema,
  "GET /sync/watched/movies": S.watchedMoviesSchema,
  "GET /shows/:id/progress/watched": S.progressSchema,
  "GET /shows/:id": S.showDetailSchema,
  "GET /movies/:id": S.movieDetailSchema,
  "GET /shows/:id/seasons": S.seasonsSchema,
  "GET /shows/:id/seasons/:s/episodes/:e": S.episodeSchema,
  "GET /sync/watchlist/shows": S.watchlistSchema,
  "GET /sync/watchlist/movies": S.watchlistSchema,
  "GET /sync/collection/shows": S.collectionShowsSchema,
  "GET /sync/collection/movies": S.collectionMoviesSchema,
  "GET /calendars/my/shows/:start/:days": S.calendarSchema,
  "GET /search/:types": S.searchSchema,
  "GET /shows/trending": S.trendingShowsSchema,
  "GET /shows/popular": S.popularShowsSchema,
  "GET /movies/trending": S.trendingMoviesSchema,
  "GET /movies/popular": S.popularMoviesSchema,
  "GET /movies/:id/related": S.popularMoviesSchema,
  "GET /shows/:id/related": S.popularShowsSchema,
  "GET /users/settings": S.userSettingsSchema,
  "GET /users/hidden/progress_watched": S.hiddenSchema,
  "GET /sync/last_activities": S.lastActivitiesSchema,
  "GET /users/me/history": S.historySchema,
  "GET /sync/history/episodes/:id": S.historySchema,
  "GET /sync/history/movies/:id": S.historySchema,
};

/**
 * Where the mock knowingly differs from Trakt, and why. Every other path the
 * mock answers has to look like something real Trakt sent.
 */
const KNOWN_DIFFERENCES: readonly {
  readonly path: RegExp;
  readonly rule: "class";
  readonly why: string;
}[] = [
  {
    path: /\.images\.[a-z_]+\[\]$/,
    rule: "class",
    why: "artwork must load from the mock in a simulator, so image URLs point at the mock with a scheme",
  },
  {
    path: /\.genres\[\]$/,
    rule: "class",
    why: "Trakt sends genre slugs such as science-fiction, and the app shows them as they come; the mock keeps display names until the app turns slugs into names",
  },
  {
    path: /^\.user\.(username|ids\.slug)$/,
    rule: "class",
    why: "Trakt usernames can be plain slugs; the one recorded account's has an underscore",
  },
];

const exempt = (path: string, rule: string): boolean =>
  KNOWN_DIFFERENCES.some((known) => known.rule === rule && known.path.test(path));

const OBJECT_KINDS: Readonly<Record<string, string>> = {
  show: "show",
  movie: "movie",
  episode: "episode",
  episodes: "episode",
  next_episode: "episode",
  last_episode: "episode",
  seasons: "season",
};

const ROOT_KINDS: readonly [RegExp, string][] = [
  [/^GET \/shows\/(:id|popular)(\/related)?$/, "show"],
  [/^GET \/movies\/(:id|popular)(\/related)?$/, "movie"],
  [/^GET \/shows\/:id\/seasons\/:s\/episodes\/:e$/, "episode"],
  [/^GET \/shows\/:id\/seasons$/, "season"],
];

/**
 * The show, movie, episode or season a path's field belongs to, and the field
 * inside it. Trakt serializes each of these the same way wherever it nests one,
 * so what one endpoint was seen sending for a field, every endpoint may send.
 */
function fieldOfKind(endpoint: string, path: string): string | null {
  const segments = path
    .split(".")
    .slice(1)
    .map((segment) => segment.replace(/\[\]$/, ""));
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const kind = OBJECT_KINDS[segments[index] ?? ""];
    if (kind !== undefined) return `${kind}:${segments.slice(index + 1).join(".")}`;
  }
  const root = ROOT_KINDS.find(([pattern]) => pattern.test(endpoint))?.[1];
  return root === undefined || segments.length === 0 ? null : `${root}:${segments.join(".")}`;
}

const BY_KIND = new Map<
  string,
  { types: Set<string>; classes: Set<string>; values: Set<string> }
>();
for (const [endpoint, shape] of Object.entries(REAL)) {
  for (const [path, want] of Object.entries(shape.paths)) {
    const key = fieldOfKind(endpoint, path);
    if (key === null) continue;
    const union = BY_KIND.get(key) ?? {
      types: new Set<string>(),
      classes: new Set<string>(),
      values: new Set<string>(),
    };
    for (const type of want.types) union.types.add(type);
    for (const value of want.enum ?? []) union.values.add(value);
    for (const kind of want.classes ?? []) union.classes.add(sameClass(kind));
    BY_KIND.set(key, union);
  }
}

function allowed(endpoint: string, path: string, want: PathShape) {
  const key = fieldOfKind(endpoint, path);
  const union = key === null ? undefined : BY_KIND.get(key);
  return {
    types: union?.types ?? new Set(want.types),
    classes: union?.classes ?? new Set((want.classes ?? []).map(sameClass)),
    values: union?.values ?? new Set(want.enum ?? []),
  };
}

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

function checkAnswers(real: EndpointShape, answers: readonly Answer[], summary: Summary): string[] {
  const problems: string[] = [];
  for (const answer of answers) {
    if (!real.statuses.includes(answer.status))
      problems.push(`status ${answer.status} never seen from Trakt`);
    const missing = real.paginationHeaders.filter((header) => !answer.headers.has(header));
    problems.push(...missing.map((header) => `missing header ${header}`));
    observe(summary, "", answer.body);
  }
  return problems;
}

function checkSentPath(endpoint: string, path: string, want: PathShape, seen: Observed): string[] {
  const permitted = allowed(endpoint, path, want);
  const types = [...seen.types].filter((type) => !permitted.types.has(type));
  const classes = [...seen.classes].map(sameClass).filter((kind) => !permitted.classes.has(kind));
  const values = [...seen.values].filter(
    (value) => want.enum !== undefined && !permitted.values.has(value),
  );
  return [
    ...(types.length > 0
      ? [`${path}: type ${types.join(",")} where Trakt sends ${[...permitted.types].join(",")}`]
      : []),
    ...(classes.length > 0 && permitted.types.has("string") && !exempt(path, "class")
      ? [
          `${path}: string class ${classes.join(",")} where Trakt sends ${[...permitted.classes].join(",")}`,
        ]
      : []),
    ...(values.length > 0 ? [`${path}: values ${values.join(",")} never seen from Trakt`] : []),
  ];
}

const READ_RULES: readonly [
  (want: PathShape, seen: Observed, parents: number) => boolean,
  string,
][] = [
  [
    (want, seen, parents) => want.always === true && seen.present < parents,
    "Trakt always sends this read field, the mock sometimes leaves it out",
  ],
  [
    (want, seen) => want.types.includes("null") && !seen.types.has("null"),
    "Trakt sends null here, the mock never does",
  ],
  [
    (want, seen) => want.empty === "sometimes" && seen.empties === 0,
    "Trakt sends empty arrays here, the mock never does",
  ],
];

function checkReadPath(path: string, want: PathShape, summary: Summary): string[] {
  const seen = summary.get(path);
  const parents = path.endsWith("[]") ? 0 : (summary.get(parentOf(path))?.objects ?? 0);
  if (seen === undefined) return parents > 0 ? [`${path}: read field never sent by the mock`] : [];
  return READ_RULES.filter(([broken]) => broken(want, seen, parents)).map(
    ([, problem]) => `${path}: ${problem}`,
  );
}

function compare(endpoint: string, answers: readonly Answer[]): string[] {
  const real = REAL[endpoint];
  if (real === undefined) return [`${endpoint}: no real shape recorded`];
  const summary: Summary = new Map();
  const problems = checkAnswers(real, answers, summary);
  for (const [path, seen] of summary) {
    const want = real.paths[path];
    problems.push(
      ...(want === undefined
        ? [`${path || "body"}: Trakt never sends this path`]
        : checkSentPath(endpoint, path, want, seen)),
    );
  }
  for (const path of pathsTheAppReads(SCHEMAS[endpoint], real)) {
    const want = real.paths[path];
    if (want !== undefined && path !== "") problems.push(...checkReadPath(path, want, summary));
  }
  return [...new Set(problems)].map((problem) => `${endpoint} ${problem}`);
}

const AF = "extended=full,images";
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const SHOWS = [8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808];
const MOVIES = [5501, 5502, 5503, 5504];

const READS: readonly string[] = [
  "/sync/last_activities",
  "/users/settings",
  "/sync/watched/shows?extended=full,progress&page=1&limit=100",
  "/sync/watched/movies?extended=images&page=1&limit=100",
  "/users/hidden/progress_watched?page=1&limit=100",
  `/sync/watchlist/shows?${AF}&page=1&limit=100`,
  `/sync/watchlist/movies?${AF}&page=1&limit=100`,
  `/sync/collection/shows?${AF}`,
  `/sync/collection/movies?${AF}&page=1&limit=100`,
  `/calendars/my/shows/${day(FIXTURE_NOW - 32 * 864e5)}/33?${AF}`,
  `/calendars/my/shows/${day(FIXTURE_NOW)}/29?${AF}`,
  `/shows/trending?${AF}&limit=24`,
  `/shows/popular?${AF}&limit=24`,
  `/movies/trending?${AF}&limit=24`,
  `/movies/popular?${AF}&limit=24`,
  ...SHOWS.flatMap((id) => [
    `/shows/${id}/progress/watched?${AF}&hidden=false&specials=false&count_specials=false`,
    `/shows/${id}/progress/watched?${AF}&hidden=false&specials=true&count_specials=true`,
    `/shows/${id}?${AF}`,
    `/shows/${id}/seasons?extended=episodes,full,images`,
    `/shows/${id}/related?${AF}&limit=6`,
  ]),
  `/shows/8801/seasons/1/episodes/1?${AF}`,
  `/shows/8803/seasons/2/episodes/3?${AF}`,
  "/sync/history/episodes/880100?extended=full&page=1&limit=30",
  "/sync/history/movies/5501?extended=full&page=1&limit=30",
  ...MOVIES.flatMap((id) => [`/movies/${id}?${AF}`, `/movies/${id}/related?${AF}&limit=12`]),
  `/search/show,movie?${AF}&query=harbor`,
  `/search/show,movie?${AF}&query=zzzz`,
  `/users/me/history?${AF}&page=1&limit=30`,
  `/users/me/history?${AF}&page=2&limit=30`,
];

const mock = createMockTrakt({ port: 0, log: false });
let base = "";

beforeAll(async () => {
  base = await mock.listen();
});

afterAll(async () => {
  await mock.close();
});

const headers = { authorization: "Bearer mock-access-token", "trakt-api-version": "2" };

const titleOf = async (path: string): Promise<string> =>
  ((await (await fetch(`${base}${path}?extended=full`, { headers })).json()) as { title: string })
    .title;

/** The scale account's thinly catalogued show (9007), one without artwork (9004), and the announced shelf titles. */
async function seedReads(seed: string): Promise<readonly string[]> {
  const announced = [await titleOf("/shows/7007"), await titleOf("/movies/6007")].map(
    (title) => `/search/show,movie?${AF}&query=${encodeURIComponent(title)}`,
  );
  if (seed !== "scale") return [...READS, ...announced, `/shows/7007?${AF}`];
  return [
    ...READS,
    ...announced,
    ...[9007, 9004].flatMap((id) => [
      `/shows/${id}/progress/watched?${AF}&hidden=false&specials=false&count_specials=false`,
      `/shows/${id}?${AF}`,
      `/shows/${id}/seasons?extended=episodes,full,images`,
    ]),
    `/search/show,movie?${AF}&query=${encodeURIComponent(await titleOf("/shows/9004"))}`,
  ];
}

async function answersFor(seed: string): Promise<Map<string, Answer[]>> {
  await fetch(`${base}/__reset?seed=${seed}`, { method: "POST" });
  const byEndpoint = new Map<string, Answer[]>();
  for (const path of await seedReads(seed)) {
    const response = await fetch(`${base}${path}`, { headers });
    if (response.status === 404) continue;
    const endpoint = templateOf("GET", path.split("?")[0] ?? path);
    const list = byEndpoint.get(endpoint) ?? [];
    list.push({ status: response.status, headers: response.headers, body: await response.json() });
    byEndpoint.set(endpoint, list);
  }
  return byEndpoint;
}

describe("the mock answers the app's reads the way real Trakt does", () => {
  it("sends only paths, types, string classes, statuses and headers Trakt sends, and covers its nulls and empties", async () => {
    const merged = new Map<string, Answer[]>();
    for (const seed of ["default", "scale"]) {
      for (const [endpoint, answers] of await answersFor(seed))
        merged.set(endpoint, [...(merged.get(endpoint) ?? []), ...answers]);
    }
    const problems = [...merged].flatMap(([endpoint, answers]) => compare(endpoint, answers));
    expect(problems).toEqual([]);
  });

  it("answers every read endpoint Trakt was recorded on", async () => {
    const answered = new Set((await answersFor("default")).keys());
    const unanswered = Object.keys(REAL).filter(
      (endpoint) => SCHEMAS[endpoint] !== undefined && !answered.has(endpoint),
    );
    expect(unanswered).toEqual([]);
  });
});
