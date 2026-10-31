type ActivityStamps = { readonly [field: string]: string | undefined };

export interface LastActivities {
  readonly all?: string;
  readonly episodes?: ActivityStamps;
  readonly shows?: ActivityStamps;
  readonly movies?: ActivityStamps;
  readonly watchlist?: ActivityStamps;
  readonly seasons?: ActivityStamps;
  readonly lists?: ActivityStamps;
  readonly account?: ActivityStamps;
  readonly collaborations?: ActivityStamps;
}

export type ActivitySection = Exclude<keyof LastActivities, "all">;

export function advanced(before: string | undefined, after: string | undefined): boolean {
  if (after === undefined) return false;
  if (before === undefined) return true;
  const a = Date.parse(after);
  const b = Date.parse(before);
  if (Number.isNaN(a) || Number.isNaN(b)) return after !== before;
  return a > b;
}
