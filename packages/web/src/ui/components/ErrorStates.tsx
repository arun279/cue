import type { TraktFailure } from "@cue/core/data/trakt/client";
import { readFailureBody } from "@cue/core/sync-contract";
import type { ReactElement } from "react";

interface ErrorRetryProps {
  readonly title: string;
  /** What actually failed, so the hint under the title is true of it: "check
   * your connection" is wrong for a rate limit, which is nobody's connection. */
  readonly failure?: TraktFailure | null;
  readonly testId: string;
  readonly buttonTestId: string;
  onRetry(): void;
}

/**
 * The hard load-failure block: a title, the honest reason, and a Retry button.
 * Distinct from genuine empty states ("Nothing tracked yet", "You're all caught
 * up"), which share the `.empty` shell but mean success, not failure.
 */
export function ErrorRetry({
  title,
  failure = null,
  testId,
  buttonTestId,
  onRetry,
}: ErrorRetryProps): ReactElement {
  return (
    <div className="empty" data-testid={testId}>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{readFailureBody(failure)}</p>
      <button type="button" className="button" data-testid={buttonTestId} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
