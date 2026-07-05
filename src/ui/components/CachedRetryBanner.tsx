import type { ReactElement } from "react";

interface CachedRetryBannerProps {
  readonly message: string;
  readonly testId: string;
  readonly buttonTestId: string;
  onRetry(): void;
}

/**
 * The cached-over-failed-refetch banner: shown when a background
 * revalidate failed but a prior cache is still on screen, so the user knows the
 * data is stale and can retry. Announced as an alert; distinct from the hard
 * "nothing cached" error state.
 */
export function CachedRetryBanner({
  message,
  testId,
  buttonTestId,
  onRetry,
}: CachedRetryBannerProps): ReactElement {
  return (
    <div className="banner banner--warn" role="alert" data-testid={testId}>
      <span>{message}</span>
      <button
        type="button"
        className="button button--ghost button--sm"
        data-testid={buttonTestId}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
