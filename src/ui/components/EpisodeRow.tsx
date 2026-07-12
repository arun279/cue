import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

/** Row heights/densities, one class hook per surface. */
type EpisodeRowVariant =
  | "queue"
  | "lapsed"
  | "on-the-way"
  | "previously"
  | "calendar"
  | "history"
  | "season"
  | "search";

/** Where the row body navigates. Extended per-screen as variants land. */
export type EpisodeRowLink =
  | { readonly to: "/show/$showId"; readonly params: { readonly showId: string } }
  | { readonly to: "/movie/$movieId"; readonly params: { readonly movieId: string } }
  | {
      readonly to: "/show/$showId/episode/$season/$episode";
      readonly params: {
        readonly showId: string;
        readonly season: string;
        readonly episode: string;
      };
    };

interface EpisodeRowProps {
  readonly variant: EpisodeRowVariant;
  /** Leading art, sized by the caller (Poster s48/s40/s32 per variant). */
  readonly art: ReactNode;
  /** Line 1: the row title (nodes allowed for mixed-weight lines). */
  readonly title: ReactNode;
  /** Line 2: the quiet meta line (episode code · name, time, "Syncing progress…"). */
  readonly meta?: ReactNode;
  /** Line 3: the progress row or relative-time caption. */
  readonly footer?: ReactNode;
  /** Trailing slot, OUTSIDE the body link: CheckControl, chip, time, overflow. */
  readonly trailing?: ReactNode;
  readonly link: EpisodeRowLink;
  /** Accessible name for the body link. */
  readonly linkLabel: string;
  readonly testId?: string;
  readonly showId?: number;
}

/**
 * The shared list-row shell: leading art + a stacked text column inside one
 * body link, with an interactive trailing slot kept ≥8px clear of it (the SPACE
 * rule). Rows sit flat on the canvas — no cards, no dividers; density comes from
 * the variant.
 */
export function EpisodeRow({
  variant,
  art,
  title,
  meta,
  footer,
  trailing,
  link,
  linkLabel,
  testId,
  showId,
}: EpisodeRowProps): ReactElement {
  return (
    <div
      className="ep-row"
      data-variant={variant}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      {...(showId === undefined ? {} : { "data-show-id": showId })}
    >
      <Link {...link} className="ep-row__body" aria-label={linkLabel}>
        <span className="ep-row__art">{art}</span>
        <span className="ep-row__text">
          <span className="ep-row__title">{title}</span>
          {meta !== undefined && <span className="ep-row__meta">{meta}</span>}
          {footer !== undefined && <span className="ep-row__footer">{footer}</span>}
        </span>
      </Link>
      {trailing !== undefined && <span className="ep-row__trailing">{trailing}</span>}
    </div>
  );
}
