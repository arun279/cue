/**
 * A path parameter is untrusted text: it arrives from a deep link, a
 * notification payload or a hand-typed URL, and `Number("")` is `NaN` rather
 * than an error. Every id in this app is a Trakt id, so the one shape worth
 * accepting is a positive integer; anything else is a link that goes nowhere and
 * must not become a request for `/shows/NaN`.
 *
 * The query-string half of the same rule lives in `@cue/core/url/search-params`
 * and is shared with the web app. This half is not: expo-router is the only
 * router that puts ids in the path.
 */
export function parseId(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
