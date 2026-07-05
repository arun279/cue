import type { ReactElement } from "react";

interface CardListSkeletonProps {
  readonly testId: string;
  readonly rows?: number;
}

/**
 * The shared poster-card loading placeholder for the card-list surfaces (Up Next,
 * Upcoming). Marked `aria-hidden` — a screen reader hears the "syncing" status
 * pill, not a wall of empty rows.
 */
export function CardListSkeleton({ testId, rows = 4 }: CardListSkeletonProps): ReactElement {
  return (
    <ul className="card-list" aria-hidden="true" data-testid={testId}>
      {Array.from({ length: rows }, (_, index) => index).map((row) => (
        <li key={row} className="card card--skeleton">
          <div className="poster poster--skeleton" />
          <div className="card__body">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </li>
      ))}
    </ul>
  );
}
