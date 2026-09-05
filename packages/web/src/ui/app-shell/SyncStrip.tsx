import type { QueryStatus } from "@cue/core/hooks/query-freshness";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import type { ReactElement } from "react";

interface SyncStripProps {
  /** The screen's change-driven read, as its hook already reports it. */
  readonly status: QueryStatus;
  /** Re-runs the failed read; the strip offers it only when nothing is already retrying. */
  readonly onRetry?: () => void;
}

/**
 * Ambient sync state, rendered directly under a screen header: nothing at all
 * while healthy (silence means synced), one 32px strip when abnormal. Which line
 * and in what order is the shared contract's call, so this renders it and
 * decides nothing: a rate limit says it is retrying and offers no button, an
 * outage over cached content offers Retry, and a read failure with nothing
 * cached says nothing here because the screen's own error state carries it.
 */
export function SyncStrip({ status, onRetry }: SyncStripProps): ReactElement | null {
  const banner = useSyncBanner(status);
  if (banner === null) return null;

  return (
    <div className="sync-strip" role="status" data-state={banner.kind} data-testid="sync-strip">
      <span className="sync-strip__dot" aria-hidden="true" />
      <span className="sync-strip__text">{banner.message}</span>
      {banner.retryable && onRetry !== undefined && (
        <button type="button" className="sync-strip__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
