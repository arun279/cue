import { z } from "zod";

export interface DecodeIssue {
  readonly path: string;
  readonly message: string;
}

export type Decoded<T> =
  | { readonly ok: true; readonly data: T; readonly skipped: readonly DecodeIssue[] }
  | { readonly ok: false; readonly issues: readonly DecodeIssue[] };

let reporting = false;
let degraded = 0;

function asNumber(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export const num = z.preprocess(asNumber, z.number());

type Issue = z.core.$ZodIssue;

function raise(ctx: z.RefinementCtx, issues: readonly Issue[]): void {
  for (const issue of issues) {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  }
}

function fallBack(ctx: z.RefinementCtx, issues: readonly Issue[]): undefined {
  degraded += 1;
  if (reporting) raise(ctx, issues);
  return undefined;
}

export function nonEssential<T extends z.ZodType>(schema: T) {
  const field = schema.optional();
  return z
    .unknown()
    .transform((input, ctx) => {
      const result = field.safeParse(input);
      return result.success ? result.data : fallBack(ctx, result.error.issues);
    })
    .optional();
}

export function list<T extends z.ZodType>(item: T) {
  return z.array(z.unknown()).transform((rows, ctx) => {
    const kept: z.output<T>[] = [];
    const dropped: Issue[] = [];
    rows.forEach((row, index) => {
      const result = item.safeParse(row);
      if (result.success) kept.push(result.data);
      else dropped.push(...result.error.issues.map((issue) => prefix(index, issue)));
    });
    if (kept.length === 0 && dropped.length > 0) {
      raise(ctx, dropped);
      return z.NEVER;
    }
    if (dropped.length > 0) fallBack(ctx, dropped);
    return kept;
  });
}

function prefix(index: number, issue: Issue): Issue {
  return { ...issue, path: [index, ...issue.path] };
}

function toIssue(issue: Issue): DecodeIssue {
  const path = issue.path.map(String).join(".");
  return { path: path === "" ? "(root)" : path, message: issue.message };
}

export function decode<T>(schema: z.ZodType<T>, input: unknown): Decoded<T> {
  degraded = 0;
  const tolerant = schema.safeParse(input);
  if (!tolerant.success) return { ok: false, issues: tolerant.error.issues.map(toIssue) };
  const strict = degraded === 0 ? tolerant : reportingParse(schema, input);
  const skipped = strict.success ? [] : strict.error.issues.map(toIssue);
  return { ok: true, data: tolerant.data, skipped };
}

function reportingParse<T>(schema: z.ZodType<T>, input: unknown) {
  reporting = true;
  try {
    return schema.safeParse(input);
  } finally {
    reporting = false;
  }
}
