import { z } from "zod";
import type { WriteReceipt } from "../../domain/write-queue/receipt";

function sumCounts(counts: Record<string, unknown>): number {
  return Object.values(counts).reduce<number>(
    (total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0),
    0,
  );
}

function countMissing(groups: Record<string, unknown>): number {
  return Object.values(groups).reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
}

const counts = z.record(z.string(), z.unknown()).transform(sumCounts).optional();

const receiptSchema = z.object({
  added: counts,
  updated: counts,
  deleted: counts,
  existing: counts,
  not_found: z.record(z.string(), z.unknown()).transform(countMissing).optional(),
});

export function parseWriteReceipt(data: unknown): WriteReceipt | null {
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) return null;
  const { added, updated, deleted, existing, not_found } = parsed.data;
  if ([added, updated, deleted, existing, not_found].every((value) => value === undefined)) {
    return null;
  }
  return {
    added: added ?? 0,
    updated: updated ?? 0,
    deleted: deleted ?? 0,
    existing: existing ?? 0,
    notFound: not_found ?? 0,
  };
}
