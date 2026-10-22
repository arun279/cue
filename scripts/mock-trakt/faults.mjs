/**
 * What the fake Trakt does when it is not answering cleanly.
 *
 * Every failure the app has to survive is a property of the SERVER, so it is
 * modelled here rather than by intercepting requests in a test: a rate limit
 * that stays armed until released, a 502 from a proxy, a slow answer,
 * a connection that hangs, a connection that dies. Driven either by
 * `MOCK_TRAKT_FAULTS` at boot or by `POST /__fault` at runtime.
 *
 * A rule:
 *   match     "reads" (GET) | "writes" (POST) | "all"        default "all"
 *   path      regex source, matched against the pathname      default any
 *   query     regex source, matched against the query string  default any
 *   status    answer with this status instead of routing      e.g. 429, 503
 *   retryAfter  seconds, sent as `Retry-After`
 *   hold      accept the request and answer only after release
 *   drop      destroy the socket before applying the route
 *   dropAfter apply the route, then destroy the socket without a response
 *   after     let this many matching requests through first
 *   count     apply to at most this many matching requests
 *
 * `{ match: "writes", status: 200 }` is the swallowed write: Trakt answers OK
 * and the account never changes, which is what the write queue's reconcile is
 * for. A rule without `count` stands until it is cleared.
 *
 * Named profiles spell each reusable failure once for the core harness and
 * simulator flows.
 */

const METHOD_OF = { reads: "GET", writes: "POST" };

/**
 * One pending episode mark, in the shape `buildMarkEpisodeOp` serializes, for a
 * harness to put into its own durable queue before the app boots. The mock
 * cannot import the core to build it, so `mock-trakt.test.ts` asserts this
 * against the real builder.
 */
const DURABLE_OP_LOG = [
  {
    id: "e2e-pending-880100",
    itemKey: "episode:880100",
    request: {
      method: "POST",
      path: "/sync/history",
      body: { episodes: [{ ids: { trakt: 880100 }, watched_at: "2026-01-01T00:00:00.000Z" }] },
    },
    inverse: {
      method: "POST",
      path: "/sync/history/remove",
      body: { episodes: [{ ids: { trakt: 880100 } }] },
    },
    inversePatch: { showId: 8801, preCompleted: 20 },
    watchedAt: "2026-01-01T00:00:00.000Z",
    fromState: "absent",
    toState: "present",
    reconcileKeys: ["progress/watched", "watched/shows"],
  },
];

const faultProfiles = {
  "next-read-401": { rules: [{ match: "reads", status: 401, count: 1 }] },
  "refuse-refresh": {
    rules: [{ path: "^/oauth/token$", status: 401, body: { error: "invalid_grant" } }],
  },
  "rate-limit-progress": {
    rules: [
      {
        match: "reads",
        path: "^/shows/[^/]+/progress/watched$",
        status: 429,
        retryAfter: 1,
        after: 1,
      },
    ],
  },
  "hold-write": { rules: [{ match: "writes", path: "^/sync/", hold: true }] },
  "drop-write": { rules: [{ match: "writes", path: "^/sync/", drop: true }] },
  "apply-drop-write": {
    rules: [{ match: "writes", path: "^/sync/history$", dropAfter: true, count: 1 }],
  },
  "fail-history-page": {
    rules: [
      {
        match: "reads",
        path: "^/users/me/history$",
        query: "(?:^|&)page=2(?:&|$)",
        status: 503,
      },
    ],
  },
  "seed-op-log": { rules: [], opLog: DURABLE_OP_LOG },
};

export const FAULT_PROFILE_NAMES = Object.keys(faultProfiles);

function armed(rule) {
  if (rule.forMs !== undefined || rule.delayMs !== undefined) {
    throw new TypeError("Use count or hold with explicit release instead of forMs/delayMs");
  }
  return {
    ...rule,
    match: rule.match ?? "all",
    pattern: rule.path === undefined ? null : new RegExp(rule.path),
    queryPattern: rule.query === undefined ? null : new RegExp(rule.query),
    skip: rule.after ?? 0,
    remaining: rule.count ?? Number.POSITIVE_INFINITY,
  };
}

function applies(rule, method, url) {
  if (rule.remaining <= 0) return false;
  const wanted = METHOD_OF[rule.match];
  if (wanted !== undefined && wanted !== method) return false;
  if (rule.pattern !== null && !rule.pattern.test(url.pathname)) return false;
  return rule.queryPattern === null || rule.queryPattern.test(url.searchParams.toString());
}

/**
 * The armed rule set. `next` consumes one use of the first rule that applies,
 * so `count` counts requests the fault actually answered.
 */
export function createFaults(spec) {
  let rules = [];
  let opLog = [];

  const arm = (input) => {
    const list = input === null || input === undefined ? [] : (input.rules ?? [input]);
    rules = list.map(armed);
    opLog = [];
    return rules.length;
  };

  arm(spec);

  return {
    arm,
    armProfile(profile) {
      const selected = faultProfiles[profile];
      if (selected === undefined) return null;
      const count = arm({ rules: selected.rules });
      opLog = selected.opLog ?? [];
      return count;
    },
    clear: () => {
      rules = [];
      opLog = [];
    },
    opLog: () => opLog,
    describe: () =>
      rules.map((rule) => ({
        match: rule.match,
        path: rule.path ?? null,
        status: rule.status ?? null,
        remaining: rule.remaining === Number.POSITIVE_INFINITY ? null : rule.remaining,
        expired: rule.remaining <= 0,
      })),
    next(method, url) {
      const rule = rules.find((candidate) => applies(candidate, method, url));
      if (rule === undefined) return null;
      if (rule.skip > 0) {
        rule.skip -= 1;
        return null;
      }
      rule.remaining -= 1;
      return rule;
    },
  };
}

/**
 * The response a `status` rule answers with; null when the rule only delays. A
 * 429 with `retryAfter` comes from Trakt's rate limiter, which also names the
 * bucket in `X-Ratelimit`; one without is the security layer's bare refusal
 * (https://developer.trakt.tv/docs/rate-limiting).
 */
export function faultResponse(rule) {
  if (rule.status === undefined) return null;
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (rule.retryAfter !== undefined) headers["retry-after"] = String(rule.retryAfter);
  if (rule.status === 429 && rule.retryAfter !== undefined) {
    headers["x-ratelimit"] = JSON.stringify({
      name: "AUTHED_API_GET_LIMIT",
      period: 300,
      limit: 500,
      remaining: 0,
      until: new Date(Date.now() + rule.retryAfter * 1000).toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }
  return {
    status: rule.status,
    headers,
    body: JSON.stringify(
      rule.body ?? (rule.status === 429 ? { error: "rate limit exceeded" } : {}),
    ),
  };
}

/** Parse `MOCK_TRAKT_FAULTS`; a malformed value is a configuration error, not a silent no-op. */
export function faultsFromEnv(raw) {
  if (raw === undefined || raw === "") return null;
  return JSON.parse(raw);
}
