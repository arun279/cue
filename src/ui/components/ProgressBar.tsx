import type { ReactElement } from "react";

interface ProgressBarProps {
  /** 0-100. Ignored when `striped` (indeterminate: no fabricated number). */
  readonly percent?: number;
  /** Static diagonal stripes: the honest sync-pending texture. */
  readonly striped?: boolean;
  readonly className?: string;
}

/**
 * The one progress bar: amber fill on the shared track, flipping to the watched
 * green when complete; a striped static pattern (never a fabricated number) while
 * a show's progress is still syncing. Purely decorative, always paired with a
 * numeric count or label by its consumer, so it carries `aria-hidden`.
 */
export function ProgressBar({
  percent = 0,
  striped = false,
  className,
}: ProgressBarProps): ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={`progress-bar${className === undefined ? "" : ` ${className}`}`}
      {...(striped ? { "data-striped": "true" } : {})}
      {...(clamped >= 100 && !striped ? { "data-complete": "true" } : {})}
      aria-hidden="true"
    >
      {!striped && <i style={{ width: `${clamped}%` }} />}
    </span>
  );
}
