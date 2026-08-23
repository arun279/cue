/**
 * The request journal: what the app asked Trakt for, in order, in a form two
 * different apps can be compared through.
 *
 * The migration's signature failure is that both apps look right and behave
 * differently against Trakt: a mark sent with a different payload, an extra
 * read, two marks coalesced that used to be separate, a write not enqueued
 * while offline. Nothing but this catches it, because each side is otherwise
 * only ever compared with its own expectations.
 *
 * The writer records faithfully and the normalizer decides what is comparable,
 * so a journal stays readable as a debugging artifact and the comparison policy
 * lives in exactly one place.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Artwork the app fetches lazily as cards settle on screen: ordering is a
 * function of scroll and layout, not of behavior. */
const ARTWORK = /\/(images|posters)\//;
/**
 * The sign-in leg, which the two targets differ on by design: the web app runs
 * the authorization-code flow through a full-page redirect, a device runs the
 * device-code flow and polls until a human approves. Its request count measures
 * how long that human took, and its payloads carry a fresh nonce and PKCE pair
 * every run, so it is not comparable even against another run of the same app.
 * What IS comparable is what happens to the token afterwards, so `/oauth/token`
 * stays: a refresh that fires twice, or never, is a real difference.
 */
const SIGN_IN = new Set(["/oauth/authorize", "/oauth/device/code", "/oauth/device/token"]);
const TOKEN = "/oauth/token";
/** Per-run or per-target values in a token exchange. `grant_type` is the field
 * that says what the exchange was, and it survives. */
const TOKEN_SECRETS = ["code", "code_verifier", "refresh_token", "redirect_uri", "client_id"];
/** Visibility-gated, so its count measures how long the tab stayed in front. */
const ACTIVITIES = "/sync/last_activities";
/** Anything derived from `Date.now()`: the calendar's window start, and the
 * `watched_at` a mark stamps. Replaced rather than dropped, so a missing one is
 * still a difference. */
const DATE = /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g;
const WINDOW = "<date>";

/**
 * Append one entry per request. With no file, the mock journals nothing and
 * costs nothing, which is what every run but the equivalence lane's wants.
 */
export function createJournal(file) {
  if (file === undefined || file === "") return { record: () => {}, file: null };
  mkdirSync(dirname(file), { recursive: true });
  // Truncated, not appended to: a journal is one run against one fresh account,
  // and two runs concatenated would compare as a behavior nobody performed.
  writeFileSync(file, "", "utf8");
  return {
    file,
    record(method, path, search, body) {
      const entry = { method, path, search, body };
      appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
    },
  };
}

/** Read a journal file back as entries. */
export const readJournal = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const stripDates = (value) => {
  if (typeof value === "string") return value.replace(DATE, WINDOW);
  if (Array.isArray(value)) return value.map(stripDates);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripDates(v)]));
  }
  return value;
};

/**
 * What two runs are allowed to be compared on. Drops the requests whose count
 * is a function of timing or layout rather than of behavior, and replaces every
 * date-shaped value so a run yesterday equals the same run today.
 */
export function normalizeJournal(entries) {
  return entries
    .filter(
      (entry) => !ARTWORK.test(entry.path) && !SIGN_IN.has(entry.path) && entry.path !== ACTIVITIES,
    )
    .map((entry) => ({
      method: entry.method,
      // The calendar carries its window start in the path, so the path is
      // stripped too. Trakt's own path segments are numeric ids, never dates.
      path: stripDates(entry.path),
      search: stripDates(entry.search ?? ""),
      body: stripDates(redactTokenExchange(entry)),
    }));
}

function redactTokenExchange(entry) {
  const body = entry.body ?? null;
  if (entry.path !== TOKEN || body === null || typeof body !== "object") return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      TOKEN_SECRETS.includes(key) ? "<redacted>" : value,
    ]),
  );
}
