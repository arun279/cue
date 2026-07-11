import { useSyncActivity } from "@ui/hooks/sync-activity-store";
import type { ReactElement } from "react";

interface SyncStatusPillProps {
  readonly testId: string;
  readonly isFetching: boolean;
  readonly isError: boolean;
  /** First-ever load with no cached snapshot yet: the initial library fan-out is
   * in flight, so the pill says so ("Syncing your library…") rather than a bare busy. */
  readonly isLoading?: boolean;
  /** The library is larger than the cold-sync progress budget, so
   * only the most-recently-watched shows are fully synced. The pill says so rather
   * than resting on "Synced · <when>" and implying the whole library is complete. */
  readonly isPartial?: boolean;
  /** Optional live item count exposed as `data-count` (Up Next queue size). */
  readonly count?: number;
  /** Epoch ms of the last successful sync; renders "Synced · 2m ago" recency. */
  readonly syncedAt?: number;
}

/** Compact recency ("just now", "2m ago", "3h ago", "2d ago") for the synced state. */
function relativeSince(then: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The header sync-state pill shared by the persisted-SWR screens: a polite live
 * region reporting Syncing / Offline / Synced (with last-synced recency) so a
 * real change-driven revalidate (or its failure) is announced without stealing
 * focus. Post-gating, `isFetching` fires only on a genuine change-driven refetch
 * (navigation no longer refetches), and the write-side flush signal is OR'd in so
 * "Syncing…" also covers a pending durable write: a plain page change with
 * nothing to sync rests truthfully on "Synced · <when>".
 *
 * Two honesty states beyond busy/offline/synced: the first cold fan-out reads
 * "Syncing your library…" (not a bare "Synced · just now" while a large account is
 * still materializing), and a library past the cold-sync progress budget rests on
 * "Recent shows synced" rather than implying every show is complete.
 */
export function SyncStatusPill({
  testId,
  isFetching,
  isError,
  isLoading = false,
  isPartial = false,
  count,
  syncedAt,
}: SyncStatusPillProps): ReactElement {
  const isWriting = useSyncActivity((state) => state.pending > 0);
  const busy = isFetching || isWriting;
  const label = busy
    ? isLoading
      ? "Syncing your library…"
      : "Syncing…"
    : isError
      ? "Offline"
      : isPartial
        ? "Recent shows synced"
        : syncedAt !== undefined && syncedAt > 0
          ? `Synced · ${relativeSince(syncedAt)}`
          : "Synced";
  return (
    <p
      className="status-pill"
      role="status"
      data-testid={testId}
      data-state={busy ? "syncing" : isError ? "offline" : "synced"}
      {...(isPartial && !busy && !isError ? { "data-partial": "true" } : {})}
      {...(count === undefined ? {} : { "data-count": count })}
    >
      {label}
    </p>
  );
}
