/** Parse an ISO timestamp to epoch ms, or `null` when absent/unparseable. */
export function toMs(iso: string | null | undefined): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Has this episode aired at or before `now`? A missing/unparseable air date is
 * treated as not-yet-aired — the aired-only surfaces must never surface an
 * episode whose air date we can't establish.
 */
export function isAired(firstAired: string | null | undefined, now: number): boolean {
  const t = toMs(firstAired);
  return t !== null && t <= now;
}
