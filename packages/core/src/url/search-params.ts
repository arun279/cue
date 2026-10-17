// Route parameters are untrusted deep-link text, so each parser drops anything it does not know.
export interface LibrarySearch {
  readonly type?: "movies";
}

export function parseLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  return search["type"] === "movies" ? { type: "movies" } : {};
}

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
  if (out.year !== undefined && Number.isInteger(month) && month >= 1 && month <= 12) {
    out.month = month;
  }
  return out;
}
