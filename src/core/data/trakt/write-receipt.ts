import { z } from "zod";
import type { WriteReceipt } from "../../domain/write-queue/receipt";
import { num } from "./decode";

const sum = (values: Record<string, number>): number =>
  Object.values(values).reduce((total, value) => total + value, 0);

const countMissing = (groups: Record<string, readonly unknown[]>): number =>
  Object.values(groups).reduce((total, items) => total + items.length, 0);

const counts = z.record(z.string(), num).transform(sum).optional();

const receiptSchema = z.object({
  added: counts,
  updated: counts,
  deleted: counts,
  existing: counts,
  not_found: z.record(z.string(), z.array(z.unknown())).transform(countMissing).optional(),
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
