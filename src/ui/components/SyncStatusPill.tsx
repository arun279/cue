import { useSyncActivity } from "@ui/hooks/sync-activity-store";
import type { ReactElement } from "react";

interface SyncStatusPillProps {
  readonly testId: string;
  readonly isFetching: boolean;
  readonly isError: boolean;
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
 * "Syncing…" also covers a pending durable write — a plain page change with
 * nothing to sync rests truthfully on "Synced · <when>".
 */
export function SyncStatusPill({
  testId,
  isFetching,
  isError,
  count,
  syncedAt,
}: SyncStatusPillProps): ReactElement {
  const isWriting = useSyncActivity((state) => state.pending > 0);
  const busy = isFetching || isWriting;
  const label = busy
    ? "Syncing…"
    : isError
      ? "Offline"
      : syncedAt !== undefined && syncedAt > 0
        ? `Synced · ${relativeSince(syncedAt)}`
        : "Synced";
  return (
    <p
      className="status-pill"
      role="status"
      data-testid={testId}
      data-state={busy ? "syncing" : isError ? "offline" : "synced"}
      {...(count === undefined ? {} : { "data-count": count })}
    >
      {label}
    </p>
  );
}
