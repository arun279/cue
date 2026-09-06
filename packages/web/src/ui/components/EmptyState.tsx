import type { ReactElement, ReactNode } from "react";

interface EmptyStateProps {
  readonly headline: string;
  readonly body?: string;
  /** Optional CTA (button/link) and any follow-on content (e.g. watchlist tiles). */
  readonly children?: ReactNode;
  readonly testId?: string;
}

/**
 * The designed empty state: a display headline, one honest sentence, and an
 * optional action. Genuine emptiness reads as success, never as failure. Hard
 * errors use `ErrorRetry` instead.
 */
export function EmptyState({ headline, body, children, testId }: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state" {...(testId === undefined ? {} : { "data-testid": testId })}>
      <h2 className="empty-state__headline">{headline}</h2>
      {body !== undefined && <p className="empty-state__body">{body}</p>}
      {children}
    </div>
  );
}
