/**
 * The two screens whose state lives in the URL, parsed once and shared. A route
 * parameter arrives as untrusted text on both targets, from a deep link or a
 * hand-edited address, so each parser drops anything it does not know
 * rather than carrying it into a query key.
 */

/** Library: which medium the segment shows. Absent means Shows. */
export interface LibrarySearch {
  readonly type?: "movies";
}

export function parseLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  return search["type"] === "movies" ? { type: "movies" } : {};
}

/** Diary: which medium, and the month it is scrolled to. */
export interface HistorySearch {
  readonly type?: "tv" | "movies";
  readonly year?: number;
  readonly month?: number;
}

export function parseHistorySearch(search: Record<string, unknown>): HistorySearch {
  const out: { type?: "tv" | "movies"; year?: number; month?: number } = {};
  if (search["type"] === "tv" || search["type"] === "movies") out.type = search["type"];
  const year = Number(search["year"]);
  if (Number.isInteger(year) && year >= 1970 && year <= 2100) out.year = year;
  const month = Number(search["month"]);
  // A month without a year is not a position, so it is dropped with it.
  if (out.year !== undefined && Number.isInteger(month) && month >= 1 && month <= 12) {
    out.month = month;
  }
  return out;
}
