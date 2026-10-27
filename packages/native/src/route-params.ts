// Route parameters are untrusted deep-link text, so each parser drops anything it does not know.
export function parseId(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseSeason(raw: string | undefined): number | null {
  return raw === "0" ? 0 : parseId(raw);
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
