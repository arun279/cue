import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as S from "@/core/data/trakt/schemas";
import { FIXTURE_NOW } from "./account.ts";
import { createTraktFake } from "./fake.ts";
import recordings from "./recordings.json" with { type: "json" };
import { runScenarios, type Wire } from "./scenarios.ts";
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
} from "./shape.ts";

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
  "GET /genres/:type": S.genresSchema,
  "GET /shows/trending": S.trendingShowsSchema,
  "GET /shows/popular": S.popularShowsSchema,
  "GET /movies/trending": S.trendingMoviesSchema,
  "GET /movies/popular": S.popularMoviesSchema,
  "GET /movies/:id/related": S.popularMoviesSchema,
  "GET /shows/:id/related": S.popularShowsSchema,
  "GET /users/settings": S.userSettingsSchema,
  "GET /users/hidden/progress_watched": S.hiddenSchema,
  "GET /users/hidden/dropped": S.hiddenSchema,
  "GET /sync/last_activities": S.lastActivitiesSchema,
  "GET /users/me/history": S.historySchema,
  "GET /sync/history/episodes/:id": S.historySchema,
  "GET /sync/history/movies/:id": S.historySchema,
};

/**
 * Where the fake knowingly differs from Trakt, and why. Every other path the
 * fake answers has to look like something real Trakt sent.
 */
const KNOWN_DIFFERENCES: readonly {
  readonly path: RegExp;
  readonly rule: "class";
  readonly why: string;
}[] = [
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
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const SHOWS = [8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808, 8809, 8810, 99, 98, 9007];
const MOVIES = [5501, 5502, 5503, 5504, 6007];

const READS: readonly string[] = [
  "/sync/last_activities",
  "/users/settings",
  "/sync/watched/shows?extended=full,progress&page=1&limit=100",
  "/sync/watched/movies?extended=images&page=1&limit=100",
  "/users/hidden/progress_watched?page=1&limit=100",
  `/users/hidden/dropped?${AF}&page=1&limit=100`,
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
  `/shows/7007?${AF}`,
  `/shows/8801/seasons/1/episodes/1?${AF}`,
  `/shows/8803/seasons/2/episodes/3?${AF}`,
  `/shows/98/seasons/2/episodes/62?${AF}`,
  `/shows/99/seasons/0/episodes/1?${AF}`,
  "/sync/history/episodes/880100?extended=full&page=1&limit=30",
  "/sync/history/movies/5501?extended=full&page=1&limit=30",
  ...MOVIES.flatMap((id) => [`/movies/${id}?${AF}`, `/movies/${id}/related?${AF}&limit=12`]),
  ...["harbor", "zzzz", "Accord", "Juniper Orchard Fable", "The Extraordinarily"].map(
    (query) => `/search/show,movie?${AF}&query=${encodeURIComponent(query)}`,
  ),
  "/genres/movies",
  "/genres/shows",
  `/users/me/history?${AF}&page=1&limit=30`,
  `/users/me/history?${AF}&page=2&limit=30`,
  `/users/me/history?${AF}&page=1&limit=1`,
];

/**
 * The fake on a clock that moves as the recordings' request guard did: GETs 1.1 s
 * apart and writes 1.5 s apart, so Trakt's rate limits hold as they did there.
 */
function pacedFake(multiplePlays: boolean) {
  let now = FIXTURE_NOW;
  const fake = createTraktFake({ multiplePlays, clock: () => now });
  const wire: Wire = async (method, path, body, token = fake.session().access_token) => {
    now += method === "GET" ? 1100 : 1500;
    const response = await fake.fetch(`https://api.trakt.tv${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const isJson = response.headers.get("content-type")?.includes("json") === true;
    return {
      status: response.status,
      header: (name) => response.headers.get(name),
      body: text === "" ? null : isJson ? JSON.parse(text) : text,
    };
  };
  const controls = {
    approve: async () => fake.approve(),
    pause: async (seconds: number) => {
      now += seconds * 1000;
    },
  };
  return { fake, wire, controls };
}

async function answers(): Promise<{ byEndpoint: Map<string, Answer[]>; missing: string[] }> {
  const { wire } = pacedFake(true);
  const byEndpoint = new Map<string, Answer[]>();
  const missing: string[] = [];
  for (const path of READS) {
    const answer = await wire("GET", path);
    const endpoint = templateOf("GET", path.split("?")[0] ?? path);
    if (answer.status === 404) missing.push(`${endpoint} answered 404 for ${path}`);
    const headers = new Headers();
    for (const name of REAL[endpoint]?.paginationHeaders ?? []) {
      const value = answer.header(name);
      if (value !== null) headers.set(name, value);
    }
    byEndpoint.set(endpoint, [
      ...(byEndpoint.get(endpoint) ?? []),
      { status: answer.status, headers, body: answer.body },
    ]);
  }
  return { byEndpoint, missing };
}

describe("the fake answers the app's reads the way real Trakt does", () => {
  it("sends only paths, types, string classes, statuses and headers Trakt sends, and covers its nulls and empties", async () => {
    const { byEndpoint, missing } = await answers();
    const problems = [...byEndpoint].flatMap(([endpoint, sent]) => compare(endpoint, sent));
    expect([...missing, ...problems]).toEqual([]);
  });

  it("tags shows and movies only with genres its genre list names for that type", async () => {
    const { byEndpoint } = await answers();
    const [movies, shows] = (byEndpoint.get("GET /genres/:type") ?? []).map(
      ({ body }) => new Set(list(body).map((genre) => String(Object(genre).slug))),
    );
    const listed = { show: shows ?? new Set(), movie: movies ?? new Set() };
    const unlisted = [...byEndpoint].flatMap(([endpoint, sent]) => {
      const summary: Summary = new Map();
      for (const answer of sent) observe(summary, "", answer.body);
      return [...summary]
        .filter(([path]) => path.endsWith("genres[]"))
        .flatMap(([path, seen]) => {
          const known =
            fieldOfKind(endpoint, path)?.startsWith("show:") === true ? listed.show : listed.movie;
          return [...seen.values]
            .filter((slug) => !known.has(slug))
            .map((slug) => `${endpoint} ${path} ${slug}`);
        });
    });
    expect(unlisted).toEqual([]);
  });

  it("answers every read endpoint Trakt was recorded on", async () => {
    const answered = new Set((await answers()).byEndpoint.keys());
    const unanswered = Object.keys(REAL).filter(
      (endpoint) => SCHEMAS[endpoint] !== undefined && !answered.has(endpoint),
    );
    expect(unanswered).toEqual([]);
  });
});

describe("the fake behaves the way real Trakt was recorded behaving", () => {
  it.each([
    ["multiple-plays-off", false],
    ["multiple-plays-on", true],
  ] as const)("on an account with %s", async (setting, keepsEveryPlay) => {
    const { wire, controls } = pacedFake(keepsEveryPlay);
    expect(await runScenarios(wire, controls, FIXTURE_NOW, keepsEveryPlay)).toEqual(
      recordings.transcripts[setting],
    );
  });
});
