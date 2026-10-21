// What Trakt says a write did. Counts are summed across sections (movies, episodes, shows, seasons).
export interface WriteReceipt {
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly existing: number;
  readonly notFound: number;
}

// A write that changed nothing and named items Trakt could not find was not applied, whatever its status.
export function receiptApplied(receipt: WriteReceipt): boolean {
  const changed = receipt.added + receipt.updated + receipt.deleted + receipt.existing;
  return changed > 0 || receipt.notFound === 0;
}

// With Multiple Plays off, a play posted for an already-watched item replaces that item's play.
export function replacedPlays(receipt: WriteReceipt | null): number {
  return receipt?.updated ?? 0;
}
