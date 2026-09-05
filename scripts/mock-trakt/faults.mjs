/**
 * What the fake Trakt does when it is not answering cleanly.
 *
 * Every failure the app has to survive is a property of the SERVER, so it is
 * modelled here rather than by intercepting requests in a test: a rate limit
 * that closes the window for a few seconds, a 502 from a proxy, a slow answer,
 * a connection that hangs, a connection that dies. Driven either by
 * `MOCK_TRAKT_FAULTS` at boot or by `POST /__fault` at runtime, so a Playwright
 * flow can arm one mid-session and watch the app react.
 *
 * A rule:
 *   match     "reads" (GET) | "writes" (POST) | "all"        default "all"
 *   path      regex source, matched against the pathname      default any
 *   status    answer with this status instead of routing      e.g. 429, 503
 *   retryAfter  seconds, sent as `Retry-After`
 *   delayMs   wait this long before answering
 *   hold      accept the request and never answer it
 *   drop      destroy the socket without a response
 *   count     apply to at most this many matching requests
 *   forMs     apply for this long after the rule is armed
 *
 * `{ match: "writes", status: 200 }` is the swallowed write: Trakt answers OK
 * and the account never changes, which is what the write queue's reconcile is
 * for. A rule with neither `count` nor `forMs` stands until it is cleared.
 */

const METHOD_OF = { reads: "GET", writes: "POST" };

function armed(rule, now) {
  return {
    ...rule,
    match: rule.match ?? "all",
    pattern: rule.path === undefined ? null : new RegExp(rule.path),
    remaining: rule.count ?? Number.POSITIVE_INFINITY,
    until: rule.forMs === undefined ? Number.POSITIVE_INFINITY : now + rule.forMs,
  };
}

function applies(rule, method, pathname, now) {
  if (rule.remaining <= 0 || now >= rule.until) return false;
  const wanted = METHOD_OF[rule.match];
  if (wanted !== undefined && wanted !== method) return false;
  return rule.pattern === null || rule.pattern.test(pathname);
}

/**
 * The armed rule set. `next` consumes one use of the first rule that applies,
 * so `count` counts requests the fault actually answered.
 */
export function createFaults(spec) {
  let rules = [];

  const arm = (input) => {
    const list = input === null || input === undefined ? [] : (input.rules ?? [input]);
    const now = Date.now();
    rules = list.map((rule) => armed(rule, now));
    return rules.length;
  };

  arm(spec);

  return {
    arm,
    clear: () => {
      rules = [];
    },
    describe: () =>
      rules.map((rule) => ({
        match: rule.match,
        path: rule.path ?? null,
        status: rule.status ?? null,
        remaining: rule.remaining === Number.POSITIVE_INFINITY ? null : rule.remaining,
        expired: Date.now() >= rule.until,
      })),
    next(method, pathname) {
      const now = Date.now();
      const rule = rules.find((candidate) => applies(candidate, method, pathname, now));
      if (rule === undefined) return null;
      rule.remaining -= 1;
      return rule;
    },
  };
}

/** The response a `status` rule answers with; null when the rule only delays. */
export function faultResponse(rule) {
  if (rule.status === undefined) return null;
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (rule.retryAfter !== undefined) headers["retry-after"] = String(rule.retryAfter);
  return {
    status: rule.status,
    headers,
    body: JSON.stringify(rule.status === 429 ? { error: "rate limit exceeded" } : {}),
  };
}

/** Parse `MOCK_TRAKT_FAULTS`; a malformed value is a configuration error, not a silent no-op. */
export function faultsFromEnv(raw) {
  if (raw === undefined || raw === "") return null;
  return JSON.parse(raw);
}
