/**
 * Behavior scenarios that write to an account and put it back, reporting only
 * what holds on any account: statuses, content types, body shapes, write answer
 * counts, which activity stamps moved, how counts changed, orderings and page
 * limits. No ids, titles or times reach a transcript.
 *
 * conformance.test.ts runs them against the fake and compares the transcript with
 * recordings.json. Those recordings were not all made by this code as it stands:
 * README.md says, per scenario, how each one was recorded.
 */

interface WireAnswer {
  readonly status: number;
  readonly header: (name: string) => string | null;
  /** Parsed JSON, the raw text of a body that is not JSON, or null when empty. */
  readonly body: unknown;
}

/** One request; `token` overrides the account's bearer, and null sends none. */
export type Wire = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  token?: string | null,
) => Promise<WireAnswer>;

/** What a person or the passing of time does between requests. */
export interface Controls {
  /** Someone enters the device code at the activation page. */
  readonly approve: () => Promise<void>;
  readonly pause: (seconds: number) => Promise<void>;
}

type Facts = Record<string, unknown>;

interface Step {
  readonly call: string;
  readonly status: number;
  readonly facts: Facts;
}

type Transcript = Record<string, readonly Step[]>;

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const traktId = (item: unknown): number => num(obj(obj(item)["ids"])["trakt"]);

const MINUTE = 60_000;
const ART = "extended=full";

/** Added, updated, deleted and existing totals, and how many of each kind Trakt did not find. */
function receipt(body: unknown): Facts {
  const answer = obj(body);
  const total = (section: unknown): number =>
    Object.values(obj(section)).reduce<number>((sum, count) => sum + num(count), 0);
  const notFound = Object.fromEntries(
    Object.entries(obj(answer["not_found"]))
      .map(([kind, items]) => [kind, list(items).length] as const)
      .filter(([, count]) => count > 0),
  );
  return {
    keys: Object.keys(answer).sort(),
    added: total(answer["added"]),
    updated: total(answer["updated"]),
    deleted: total(answer["deleted"]),
    existing: total(answer["existing"]),
    notFound,
  };
}

/** `section.key` for every stamp in `after` later than the same stamp in `before`. */
function moved(before: unknown, after: unknown): readonly string[] {
  const changed: string[] = [];
  for (const [section, stamps] of Object.entries(obj(after))) {
    for (const [key, at] of Object.entries(obj(stamps))) {
      const was = str(obj(obj(before)[section])[key]);
      if (str(at) > was) changed.push(`${section}.${key}`);
    }
  }
  return changed.sort();
}

function pagination(answer: WireAnswer): Facts {
  const limit = answer.header("x-pagination-limit");
  const rows = list(answer.body).length;
  return {
    limit,
    paged: answer.header("x-pagination-page-count") !== null,
    withinLimit: limit === null || rows <= Number(limit),
    empty: rows === 0,
  };
}

class Recorder {
  readonly steps: Step[] = [];
  readonly wire: Wire;
  readonly controls: Controls;

  constructor(wire: Wire, controls: Controls) {
    this.wire = wire;
    this.controls = controls;
  }

  async step(
    label: string,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    facts: (answer: WireAnswer) => Facts,
    token?: string | null,
  ): Promise<WireAnswer> {
    const answer = await this.wire(method, path, body, token);
    this.steps.push({ call: label, status: answer.status, facts: facts(answer) });
    return answer;
  }
}

interface Roles {
  readonly show: number;
  readonly next: number;
  readonly last: number;
  readonly otherNext: number;
}

const progressPath = (show: number): string =>
  `/shows/${show}/progress/watched?${ART}&hidden=false&specials=false&count_specials=false`;

/** The show's next aired episode and its last watched one, when it has both and that one has a single play. */
async function rolesOf(rec: Recorder, show: number, now: number) {
  const progress = obj((await rec.wire("GET", progressPath(show))).body);
  const next = obj(progress["next_episode"]);
  if (progress["last_episode"] === null || !(Date.parse(str(next["first_aired"])) <= now))
    return null;
  const last = traktId(progress["last_episode"]);
  return (await plays(rec, last)).length === 1 ? { show, next: traktId(next), last } : null;
}

/** Two shows partway through, each with an aired episode still to watch, read from the account itself. */
async function findRoles(rec: Recorder, now: number): Promise<Roles> {
  const watched = list((await rec.wire("GET", `/sync/watched/shows?${ART}&page=1&limit=25`)).body);
  const hidden = new Set(
    list((await rec.wire("GET", "/users/hidden/progress_watched?page=1&limit=100")).body).map(
      (row) => traktId(obj(row)["show"]),
    ),
  );
  const found: { show: number; next: number; last: number }[] = [];
  for (const row of watched) {
    if (found.length === 2) break;
    const show = obj(obj(row)["show"]);
    const partway = num(obj(row)["plays"]) < num(show["aired_episodes"]);
    if (!partway || str(show["status"]) === "ended" || hidden.has(traktId(show))) continue;
    const roles = await rolesOf(rec, traktId(show), now);
    if (roles !== null) found.push(roles);
  }
  const [first, second] = found;
  if (first === undefined || second === undefined) throw new Error("no two shows in progress");
  return { ...first, otherNext: second.next };
}

/** A minute-precision instant 45 seconds in, so truncation and rounding answer differently. */
const markTime = (now: number): string =>
  new Date(Math.floor(now / MINUTE) * MINUTE + 45_000).toISOString();
const minuteOf = (iso: string): string =>
  new Date(Math.floor(Date.parse(iso) / MINUTE) * MINUTE).toISOString();

async function plays(rec: Recorder, episode: number) {
  const rows = list(
    (await rec.wire("GET", `/sync/history/episodes/${episode}?extended=full&page=1&limit=30`)).body,
  );
  return rows.map((row) => ({ id: num(obj(row)["id"]), at: str(obj(row)["watched_at"]) }));
}

async function markAndUndo(rec: Recorder, roles: Roles, now: number): Promise<void> {
  const before = (await rec.wire("GET", "/sync/last_activities")).body;
  const progress = obj((await rec.wire("GET", progressPath(roles.show))).body);
  const at = markTime(now);
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    { episodes: [{ ids: { trakt: roles.next }, watched_at: at }] },
    (answer) => ({
      ...receipt(answer.body),
      rateLimitHeader: answer.header("x-ratelimit") !== null,
    }),
  );
  const afterMark = (await rec.wire("GET", "/sync/last_activities")).body;
  await rec.step(
    "GET /shows/:id/progress/watched",
    "GET",
    progressPath(roles.show),
    undefined,
    (answer) => {
      const after = obj(answer.body);
      return {
        completedDelta: num(after["completed"]) - num(progress["completed"]),
        nextMoved: traktId(after["next_episode"]) !== roles.next,
        lastIsMarked: traktId(after["last_episode"]) === roles.next,
        lastWatchedAtIsMinute: str(after["last_watched_at"]) === minuteOf(at),
        activitiesMoved: moved(before, afterMark),
      };
    },
  );
  const history = await rec.step(
    "GET /sync/history/episodes/:id",
    "GET",
    `/sync/history/episodes/${roles.next}?extended=full&page=1&limit=30`,
    undefined,
    (answer) => {
      const rows = list(answer.body).map(obj);
      return {
        ...pagination(answer),
        storedMinuteOfSent: str(rows[0]?.["watched_at"]) === minuteOf(at),
        actions: [...new Set(rows.map((row) => str(row["action"])))],
      };
    },
  );
  const play = num(obj(list(history.body)[0])["id"]);
  await rec.step(
    "POST /sync/history/remove",
    "POST",
    "/sync/history/remove",
    { ids: [play] },
    (answer) => receipt(answer.body),
  );
  const afterUndo = (await rec.wire("GET", "/sync/last_activities")).body;
  await rec.step(
    "GET /shows/:id/progress/watched",
    "GET",
    progressPath(roles.show),
    undefined,
    (answer) => ({
      completedDelta: num(obj(answer.body)["completed"]) - num(progress["completed"]),
      nextIsMarked: traktId(obj(answer.body)["next_episode"]) === roles.next,
      activitiesMoved: moved(afterMark, afterUndo),
    }),
  );
}

async function rewatch(
  rec: Recorder,
  roles: Roles,
  now: number,
  keepsEveryPlay: boolean,
): Promise<void> {
  const original = await plays(rec, roles.last);
  if (original.length !== 1) throw new Error("the last watched episode needs exactly one play");
  const progress = obj((await rec.wire("GET", progressPath(roles.show))).body);
  const at = markTime(now);
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    { episodes: [{ ids: { trakt: roles.last }, watched_at: at }] },
    (answer) => receipt(answer.body),
  );
  const after = await plays(rec, roles.last);
  await rec.step(
    "GET /shows/:id/progress/watched",
    "GET",
    progressPath(roles.show),
    undefined,
    (answer) => ({
      completedDelta: num(obj(answer.body)["completed"]) - num(progress["completed"]),
      playsDelta: after.length - original.length,
      newestIsSent: after[0]?.at === minuteOf(at),
      earlierPlayKept: original.every((play) => after.some((row) => row.at === play.at)),
    }),
  );
  const fresh = after.find((row) => !original.some((play) => play.id === row.id));
  const restore = keepsEveryPlay
    ? rec.step(
        "POST /sync/history/remove",
        "POST",
        "/sync/history/remove",
        { ids: [fresh?.id ?? 0] },
        (answer) => receipt(answer.body),
      )
    : rec.step(
        "POST /sync/history",
        "POST",
        "/sync/history",
        { episodes: [{ ids: { trakt: roles.last }, watched_at: original[0]?.at }] },
        (answer) => receipt(answer.body),
      );
  await restore;
  const restored = await plays(rec, roles.last);
  rec.steps.push({
    call: "GET /sync/history/episodes/:id",
    status: 200,
    facts: {
      restored:
        restored.length === original.length &&
        original.every((play) => restored.some((row) => row.at === play.at)),
    },
  });
}

async function tiedMarks(rec: Recorder, roles: Roles, now: number): Promise<void> {
  const at = markTime(now);
  const episodes = [roles.next, roles.otherNext];
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    { episodes: episodes.map((trakt) => ({ ids: { trakt }, watched_at: at })) },
    (answer) => receipt(answer.body),
  );
  const rows = list(
    (await rec.wire("GET", "/users/me/history/episodes?extended=full&page=1&limit=2")).body,
  ).map(obj);
  const ours = rows.filter(
    (row) => str(row["watched_at"]) === minuteOf(at) && episodes.includes(traktId(row["episode"])),
  );
  const ids = ours.map((row) => num(row["id"]));
  rec.steps.push({
    call: "GET /users/me/history/episodes",
    status: 200,
    facts: {
      bothNewest: ours.length === 2,
    },
  });
  await rec.step("POST /sync/history/remove", "POST", "/sync/history/remove", { ids }, (answer) =>
    receipt(answer.body),
  );
}

async function unknownItems(rec: Recorder): Promise<void> {
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    { episodes: [{ ids: { trakt: 999_999_999 } }] },
    (answer) => receipt(answer.body),
  );
  await rec.step(
    "POST /sync/history/remove",
    "POST",
    "/sync/history/remove",
    { ids: [1] },
    (answer) => receipt(answer.body),
  );
}

async function paging(rec: Recorder): Promise<void> {
  const page = (path: string) =>
    rec.step(`GET ${path.split("?")[0]}`, "GET", path, undefined, pagination);
  await page("/users/me/history?page=1&limit=1000");
  await page("/sync/collection/shows");
  await page("/sync/watched/shows?extended=progress&page=1&limit=1000");
  await page("/shows/trending");
  await page("/users/me/history?page=999&limit=10");
}

async function listToggle(
  rec: Recorder,
  path: string,
  listPath: string,
  show: number,
  extra: (present: boolean) => Promise<Facts> = async () => ({}),
): Promise<void> {
  const body = { shows: [{ ids: { trakt: show } }] };
  const contains = async (): Promise<boolean> =>
    list((await rec.wire("GET", listPath)).body).some((row) => traktId(obj(row)["show"]) === show);
  const before = (await rec.wire("GET", "/sync/last_activities")).body;
  await rec.step(`POST ${path}`, "POST", path, body, (answer) => receipt(answer.body));
  await rec.step(`POST ${path}`, "POST", path, body, (answer) => receipt(answer.body));
  const after = (await rec.wire("GET", "/sync/last_activities")).body;
  rec.steps.push({
    call: `GET ${listPath.split("?")[0]}`,
    status: 200,
    facts: {
      listed: await contains(),
      activitiesMoved: moved(before, after),
      ...(await extra(true)),
    },
  });
  await rec.step(`POST ${path}/remove`, "POST", `${path}/remove`, body, (answer) =>
    receipt(answer.body),
  );
  rec.steps.push({
    call: `GET ${listPath.split("?")[0]}`,
    status: 200,
    facts: { listed: await contains(), ...(await extra(false)) },
  });
}

async function calendarShow(rec: Recorder, now: number): Promise<{ show: number; path: string }> {
  const path = `/calendars/my/shows/${new Date(now).toISOString().slice(0, 10)}/7?${ART}`;
  const answer = await rec.wire("GET", path);
  return { show: traktId(obj(list(answer.body)[0])["show"]), path };
}

/** The media type of an answer, without its parameters, or null when it names none. */
const contentType = (answer: WireAnswer): string | null =>
  answer.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null;

/** A JSON body's structure: every key, and each value's type; arrays are not entered. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, shapeOf(child)]),
  );
}

/** A body whose bytes are the fact: an empty one, the text of a 401, a refusal's JSON. */
const exactly = (answer: WireAnswer): Facts => ({
  contentType: contentType(answer),
  body: answer.body ?? "",
});

const NOBODY = 999_999_999;
const LIMIT = "page=1&limit=1000";

async function oauth(rec: Recorder): Promise<void> {
  const client = { client_id: "client" };
  const code = obj(
    (
      await rec.step(
        "POST /oauth/device/code",
        "POST",
        "/oauth/device/code",
        { ...client, code_challenge: "challenge", code_challenge_method: "S256" },
        (answer) => {
          const body = obj(answer.body);
          return {
            contentType: contentType(answer),
            shape: shapeOf(body),
            expiresIn: body["expires_in"],
            interval: body["interval"],
            userCodeLength: str(body["user_code"]).length,
            verificationUrl: body["verification_url"],
          };
        },
        null,
      )
    ).body,
  );
  const poll = { ...client, code: str(code["device_code"]), code_verifier: "verifier" };
  await rec.step("POST /oauth/device/token", "POST", "/oauth/device/token", poll, exactly, null);
  await rec.controls.approve();
  await rec.controls.pause(num(code["interval"]));
  const granted = obj(
    (
      await rec.step(
        "POST /oauth/device/token",
        "POST",
        "/oauth/device/token",
        poll,
        (answer) => {
          const body = obj(answer.body);
          return {
            contentType: contentType(answer),
            shape: shapeOf(body),
            expiresIn: body["expires_in"],
            scope: body["scope"],
            tokenType: body["token_type"],
          };
        },
        null,
      )
    ).body,
  );
  const refreshWith = (token: string) => ({
    ...client,
    refresh_token: token,
    redirect_uri: "cue://auth/callback",
    grant_type: "refresh_token",
  });
  const rotated = obj(
    (
      await rec.step(
        "POST /oauth/token",
        "POST",
        "/oauth/token",
        refreshWith(str(granted["refresh_token"])),
        (answer) => {
          const body = obj(answer.body);
          return {
            contentType: contentType(answer),
            shape: shapeOf(body),
            expiresAtIsCreatedPlusLifetime:
              num(body["expires_at"]) === num(body["created_at"]) + num(body["expires_in"]),
            rotated:
              body["access_token"] !== granted["access_token"] &&
              body["refresh_token"] !== granted["refresh_token"],
          };
        },
        null,
      )
    ).body,
  );
  const settings = (token: unknown) =>
    rec.step("GET /users/settings", "GET", "/users/settings", undefined, () => ({}), str(token));
  await settings(rotated["access_token"]);
  await settings(granted["access_token"]);
  await rec.step(
    "POST /oauth/revoke",
    "POST",
    "/oauth/revoke",
    { ...client, token: str(rotated["access_token"]) },
    exactly,
    null,
  );
  await settings(rotated["access_token"]);
  for (const token of [str(rotated["refresh_token"]), "never-issued"])
    await rec.step("POST /oauth/token", "POST", "/oauth/token", refreshWith(token), exactly, null);
}

async function errors(rec: Recorder): Promise<void> {
  await rec.step("GET /shows/:id", "GET", `/shows/${NOBODY}`, undefined, exactly);
  await rec.step(
    "GET /users/settings",
    "GET",
    "/users/settings",
    undefined,
    exactly,
    "never-issued",
  );
}

const limits = (answer: WireAnswer): Facts => ({
  limit: answer.header("x-pagination-limit"),
  paged: answer.header("x-pagination-page-count") !== null,
});

const emptyPage = (answer: WireAnswer): Facts => ({
  limit: answer.header("x-pagination-limit"),
  pageCount: answer.header("x-pagination-page-count"),
  itemCount: answer.header("x-pagination-item-count"),
  empty: list(answer.body).length === 0,
});

const idsOf = async (rec: Recorder, path: string, kind: "show" | "movie"): Promise<number[]> =>
  list((await rec.wire("GET", path)).body).map((row) => traktId(obj(row)[kind]));

/** A title in the collection with no plays: what a scenario can mark and put back. */
async function unplayed(
  rec: Recorder,
  kind: "show" | "movie",
  fits: (id: number) => Promise<boolean>,
) {
  const played = new Set(await idsOf(rec, `/sync/watched/${kind}s?page=1&limit=100`, kind));
  for (const id of await idsOf(rec, `/sync/collection/${kind}s?page=1&limit=100`, kind)) {
    if (!played.has(id) && (await fits(id))) return id;
  }
  throw new Error(`no ${kind} without plays in the collection`);
}

const seasonsOf = async (rec: Recorder, show: number) =>
  list((await rec.wire("GET", `/shows/${show}/seasons?extended=episodes,full`)).body).map(obj);

/** An unplayed show with specials and a first season that has fully aired. */
async function unplayedShow(rec: Recorder, now: number) {
  let size = 0;
  const show = await unplayed(rec, "show", async (id) => {
    const seasons = await seasonsOf(rec, id);
    const first = list(seasons.find((season) => season["number"] === 1)?.["episodes"]).map(obj);
    size = first.length;
    const aired = first.every((ep) => Date.parse(str(ep["first_aired"])) <= now);
    return seasons.some((season) => season["number"] === 0) && size > 1 && aired;
  });
  return { show, size };
}

async function pageLimits(rec: Recorder, now: number): Promise<void> {
  const page = (path: string, facts = limits) =>
    rec.step(
      `GET ${path.split("?")[0]?.replace(/\/\d+(?=\/|$)/, "/:id")}`,
      "GET",
      path,
      undefined,
      facts,
    );
  const { show } = await unplayedShow(rec, now);
  const movie = await unplayed(rec, "movie", async () => true);
  const lists = [
    "/sync/watchlist/shows",
    "/sync/collection/movies",
    "/users/hidden/progress_watched",
    "/users/hidden/dropped",
    "/sync/watched/movies",
    "/search/show?query=the",
    `/shows/${show}/related`,
  ];
  for (const path of lists) {
    await page(path);
    await page(`${path}${path.includes("?") ? "&" : "?"}${LIMIT}`);
  }
  await page(`/sync/watchlist/movies?${LIMIT}`);
  await page("/users/me/history/movies");
  await page(`/sync/history/movies/${movie}`, emptyPage);
  await page(`/sync/history/shows/${show}`, emptyPage);
}

async function watchlist(rec: Recorder): Promise<void> {
  const listed = new Set(await idsOf(rec, "/sync/watchlist/shows?page=1&limit=250", "show"));
  const listedMovies = new Set(
    await idsOf(rec, "/sync/watchlist/movies?page=1&limit=250", "movie"),
  );
  const show = (await idsOf(rec, "/sync/watched/shows?page=1&limit=100", "show")).find(
    (id) => !listed.has(id),
  );
  const movie = (await idsOf(rec, "/sync/watched/movies?page=1&limit=100", "movie")).find(
    (id) => !listedMovies.has(id),
  );
  let count: number | null = null;
  const write = (path: string, body: unknown) =>
    rec.step(`POST ${path}`, "POST", path, body, (answer) => {
      const items = num(obj(obj(answer.body)["list"])["item_count"]);
      const delta = count === null ? null : items - count;
      count = items;
      return { ...receipt(answer.body), shape: shapeOf(answer.body), itemCountDelta: delta };
    });
  let before = (await rec.wire("GET", "/sync/last_activities")).body;
  const activities = async (written: unknown) => {
    const after = (await rec.wire("GET", "/sync/last_activities")).body;
    rec.steps.push({
      call: "GET /sync/last_activities",
      status: 200,
      facts: {
        activitiesMoved: moved(before, after),
        stampIsList:
          obj(obj(after)["watchlist"])["updated_at"] === obj(obj(written)["list"])["updated_at"],
      },
    });
    before = after;
  };
  const shows = { shows: [{ ids: { trakt: show } }, { ids: { trakt: NOBODY } }] };
  const movies = { movies: [{ ids: { trakt: movie } }] };
  await activities((await write("/sync/watchlist", shows)).body);
  await write("/sync/watchlist", { shows: [{ ids: { trakt: show } }] });
  await activities((await write("/sync/watchlist", movies)).body);
  await activities((await write("/sync/watchlist/remove", shows)).body);
  await activities((await write("/sync/watchlist/remove", movies)).body);
}

async function seasonMark(rec: Recorder, now: number): Promise<void> {
  const { show, size } = await unplayedShow(rec, now);
  const first = new Date(Math.floor((now - 3 * 86_400_000) / MINUTE) * MINUTE).toISOString();
  const history = `/sync/history/shows/${show}`;
  await rec.step("GET /sync/history/shows/:id", "GET", history, undefined, emptyPage);
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    {
      shows: [
        {
          ids: { trakt: show },
          seasons: [{ number: 1, episodes: [{ number: 1, watched_at: first }] }],
        },
      ],
    },
    (answer) => ({ ...receipt(answer.body), shape: shapeOf(answer.body) }),
  );
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    {
      shows: [
        { ids: { trakt: show }, seasons: [{ number: 1 }, { number: 99 }] },
        { ids: { trakt: NOBODY }, seasons: [{ number: 1 }] },
      ],
    },
    (answer) => {
      const { added, ...rest } = receipt(answer.body);
      const echoed = obj(list(obj(obj(answer.body)["not_found"])["seasons"])[0]);
      return {
        ...rest,
        addedIsRestOfSeason: added === size - 1,
        seasonsEchoWhole: list(echoed["seasons"]).length === 2,
      };
    },
  );
  await rec.step("GET /sync/history/shows/:id", "GET", history, undefined, (answer) => {
    const rows = list(answer.body).map(obj);
    const numbers = rows.map((row) => num(obj(row["episode"])["number"]));
    return {
      playsAreSeason: rows.length === size,
      oneStamp: new Set(rows.map((row) => row["watched_at"])).size === 1,
      firstPlayOverwritten: !rows.some((row) => row["watched_at"] === first),
      laterEpisodeFirst: numbers.every(
        (number, index) => index === 0 || number < (numbers[index - 1] ?? 0),
      ),
    };
  });
  await rec.step(
    "POST /sync/history/remove",
    "POST",
    "/sync/history/remove",
    { shows: [{ ids: { trakt: show }, seasons: [{ number: 1 }] }] },
    (answer) => {
      const { deleted, ...rest } = receipt(answer.body);
      return { ...rest, deletedIsSeason: deleted === size };
    },
  );
}

async function specials(rec: Recorder, now: number): Promise<void> {
  const { show } = await unplayedShow(rec, now);
  const special = (episode: object) => ({
    shows: [{ ids: { trakt: show }, seasons: [{ number: 0, episodes: [episode] }] }],
  });
  await rec.step(
    "POST /sync/history",
    "POST",
    "/sync/history",
    special({ number: 1, watched_at: markTime(now) }),
    (a) => receipt(a.body),
  );
  await rec.step(
    "POST /sync/history/remove",
    "POST",
    "/sync/history/remove",
    special({ number: 1 }),
    (a) => receipt(a.body),
  );
}

async function movieRewatch(rec: Recorder, now: number): Promise<void> {
  const movie = await unplayed(rec, "movie", async () => true);
  const at = (daysAgo: number) =>
    new Date(Math.floor(now / 86_400_000 - daysAgo) * 86_400_000 + 20 * 3_600_000).toISOString();
  const play = (watchedAt: string) =>
    rec.step(
      "POST /sync/history",
      "POST",
      "/sync/history",
      { movies: [{ ids: { trakt: movie }, watched_at: watchedAt }] },
      (a) => receipt(a.body),
    );
  await play(at(4));
  await play(at(3));
  await rec.step(
    "GET /sync/history/movies/:id",
    "GET",
    `/sync/history/movies/${movie}?${LIMIT}`,
    undefined,
    (answer) => ({
      limit: answer.header("x-pagination-limit"),
      plays: list(answer.body).length,
      newestIsSecond: obj(list(answer.body)[0])["watched_at"] === at(3),
    }),
  );
  await rec.step(
    "POST /sync/history/remove",
    "POST",
    "/sync/history/remove",
    { movies: [{ ids: { trakt: movie } }, { ids: { trakt: NOBODY } }] },
    (a) => receipt(a.body),
  );
}

type Scenario = (rec: Recorder, roles: Roles, now: number) => Promise<void>;

const ONE_PLAY_SCENARIOS: Readonly<Record<string, Scenario>> = {
  markAndUndo,
  rewatch: (rec, roles, now) => rewatch(rec, roles, now, false),
  tiedMarks,
  unknownItems: (rec) => unknownItems(rec),
  paging: (rec) => paging(rec),
  hidden: (rec, roles) =>
    listToggle(
      rec,
      "/users/hidden/progress_watched",
      "/users/hidden/progress_watched?page=1&limit=100",
      roles.show,
    ),
  dropped: async (rec, _roles, now) => {
    const airing = await calendarShow(rec, now);
    const onCalendar = async (): Promise<boolean> =>
      list((await rec.wire("GET", airing.path)).body).some(
        (row) => traktId(obj(row)["show"]) === airing.show,
      );
    await listToggle(
      rec,
      "/users/hidden/dropped",
      "/users/hidden/dropped?page=1&limit=100",
      airing.show,
      async () => ({ onCalendar: await onCalendar() }),
    );
  },
  oauth: (rec) => oauth(rec),
  errors: (rec) => errors(rec),
  pageLimits: (rec, _roles, now) => pageLimits(rec, now),
  watchlist: (rec) => watchlist(rec),
  seasonMark: (rec, _roles, now) => seasonMark(rec, now),
  specials: (rec, _roles, now) => specials(rec, now),
  movieRewatch: (rec, _roles, now) => movieRewatch(rec, now),
};

const EVERY_PLAY_SCENARIOS: Readonly<Record<string, Scenario>> = {
  rewatch: (rec, roles, now) => rewatch(rec, roles, now, true),
  movieRewatch: (rec, _roles, now) => movieRewatch(rec, now),
};

/**
 * Every scenario for an account whose Multiple Plays setting is `keepsEveryPlay`,
 * or only the named ones, in a fixed order.
 */
export async function runScenarios(
  wire: Wire,
  controls: Controls,
  now: number,
  keepsEveryPlay: boolean,
  only?: readonly string[],
): Promise<Transcript> {
  const roles = await findRoles(new Recorder(wire, controls), now);
  const transcript: Record<string, readonly Step[]> = {};
  const scenarios = keepsEveryPlay ? EVERY_PLAY_SCENARIOS : ONE_PLAY_SCENARIOS;
  for (const [name, run] of Object.entries(scenarios)) {
    if (only !== undefined && !only.includes(name)) continue;
    const rec = new Recorder(wire, controls);
    await run(rec, roles, now);
    transcript[name] = rec.steps;
  }
  return transcript;
}
