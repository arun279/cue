import type { ReactElement } from "react";

interface SyncStatusPillProps {
  readonly testId: string;
  readonly isFetching: boolean;
  readonly isError: boolean;
  /** Optional live item count exposed as `data-count` (Up Next queue size). */
  readonly count?: number;
}

/**
 * The header sync-state pill shared by the persisted-SWR screens: a polite live
 * region reporting Syncing / Offline / Synced so a background revalidate (or its
 * failure) is announced without stealing focus.
 */
export function SyncStatusPill({
  testId,
  isFetching,
  isError,
  count,
}: SyncStatusPillProps): ReactElement {
  return (
    <p
      className="status-pill"
      role="status"
      data-testid={testId}
      data-state={isFetching ? "syncing" : isError ? "offline" : "synced"}
      {...(count === undefined ? {} : { "data-count": count })}
    >
      {isFetching ? "Syncing…" : isError ? "Offline" : "Synced"}
    </p>
  );
}
