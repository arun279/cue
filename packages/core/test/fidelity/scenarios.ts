/**
 * Behavior scenarios run the same way against real Trakt and against the mock.
 * Each one writes to the account and puts it back, and reports only what holds
 * on any account: statuses, write answer counts, which activity stamps moved,
 * how counts changed, orderings, header limits. No ids, titles or times reach
 * the transcript, so a transcript recorded on a real account can be committed.
 */

interface WireAnswer {
  readonly status: number;
  readonly header: (name: string) => string | null;
  readonly body: unknown;
}

export type Wire = (method: "GET" | "POST", path: string, body?: unknown) => Promise<WireAnswer>;

type Facts = Record<string, unknown>;

interface Step {
  readonly call: string;
  readonly status: number;
  readonly facts: Facts;
}

export type Transcript = Record<string, readonly Step[]>;

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

  constructor(private readonly wire: Wire) {}

  async call(method: "GET" | "POST", path: string, body?: unknown): Promise<WireAnswer> {
    return this.wire(method, path, body);
  }

  async step(
    label: string,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    facts: (answer: WireAnswer) => Facts,
  ): Promise<WireAnswer> {
    const answer = await this.wire(method, path, body);
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

/** Two shows partway through, each with an aired episode still to watch, read from the account itself. */
/** The show's next aired episode and its last watched one, when it has both and that one has a single play. */
async function rolesOf(rec: Recorder, show: number, now: number) {
  const progress = obj((await rec.call("GET", progressPath(show))).body);
  const next = obj(progress["next_episode"]);
  if (progress["last_episode"] === null || !(Date.parse(str(next["first_aired"])) <= now))
    return null;
  const last = traktId(progress["last_episode"]);
  return (await plays(rec, last)).length === 1 ? { show, next: traktId(next), last } : null;
}

/** Two shows partway through, each with an aired episode still to watch, read from the account itself. */
async function findRoles(rec: Recorder, now: number): Promise<Roles> {
  const watched = list((await rec.call("GET", `/sync/watched/shows?${ART}&page=1&limit=25`)).body);
  const hidden = new Set(
    list((await rec.call("GET", "/users/hidden/progress_watched?page=1&limit=100")).body).map(
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
    (await rec.call("GET", `/sync/history/episodes/${episode}?extended=full&page=1&limit=30`)).body,
  );
  return rows.map((row) => ({ id: num(obj(row)["id"]), at: str(obj(row)["watched_at"]) }));
}

async function markAndUndo(rec: Recorder, roles: Roles, now: number): Promise<void> {
  const before = (await rec.call("GET", "/sync/last_activities")).body;
  const progress = obj((await rec.call("GET", progressPath(roles.show))).body);
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
  const afterMark = (await rec.call("GET", "/sync/last_activities")).body;
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
  const afterUndo = (await rec.call("GET", "/sync/last_activities")).body;
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
  const progress = obj((await rec.call("GET", progressPath(roles.show))).body);
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
    (await rec.call("GET", "/users/me/history/episodes?extended=full&page=1&limit=2")).body,
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
    list((await rec.call("GET", listPath)).body).some((row) => traktId(obj(row)["show"]) === show);
  const before = (await rec.call("GET", "/sync/last_activities")).body;
  await rec.step(`POST ${path}`, "POST", path, body, (answer) => receipt(answer.body));
  await rec.step(`POST ${path}`, "POST", path, body, (answer) => receipt(answer.body));
  const after = (await rec.call("GET", "/sync/last_activities")).body;
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
  const answer = await rec.call("GET", path);
  return { show: traktId(obj(list(answer.body)[0])["show"]), path };
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
      list((await rec.call("GET", airing.path)).body).some(
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
};

const EVERY_PLAY_SCENARIOS: Readonly<Record<string, Scenario>> = {
  rewatch: (rec, roles, now) => rewatch(rec, roles, now, true),
};

/**
 * Every scenario for an account whose Multiple Plays setting is `keepsEveryPlay`,
 * or only the named ones, in a fixed order.
 */
export async function runScenarios(
  wire: Wire,
  now: number,
  keepsEveryPlay: boolean,
  only?: readonly string[],
): Promise<Transcript> {
  const roles = await findRoles(new Recorder(wire), now);
  const transcript: Record<string, readonly Step[]> = {};
  const scenarios = keepsEveryPlay ? EVERY_PLAY_SCENARIOS : ONE_PLAY_SCENARIOS;
  for (const [name, run] of Object.entries(scenarios)) {
    if (only !== undefined && !only.includes(name)) continue;
    const rec = new Recorder(wire);
    await run(rec, roles, now);
    transcript[name] = rec.steps;
  }
  return transcript;
}
