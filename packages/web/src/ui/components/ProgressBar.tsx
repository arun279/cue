import type { ReactElement } from "react";

interface ProgressBarProps {
  /** 0-100. */
  readonly percent?: number;
  readonly className?: string;
}

/**
 * The one progress bar: amber fill on the shared track, flipping to the watched
 * green when complete. Purely decorative, always paired with a numeric count or
 * label by its consumer, so it carries `aria-hidden`.
 */
export function ProgressBar({ percent = 0, className }: ProgressBarProps): ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={`progress-bar${className === undefined ? "" : ` ${className}`}`}
      {...(clamped >= 100 ? { "data-complete": "true" } : {})}
      aria-hidden="true"
    >
      <i style={{ width: `${clamped}%` }} />
    </span>
  );
}
