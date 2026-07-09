import { initialsOf } from "@data/image-source";
import type { ReactElement } from "react";

/** The one "no artwork" mark reused by every placeholder: a quiet media
 * glyph that reads as *deliberately* art-less, not a broken image. Medium-neutral
 * — the card's own badge/context already says show vs movie — so it never needs
 * threading a `medium` prop through every caller. */
function MediaGlyph(): ReactElement {
  return (
    <svg
      className="art-ph__glyph"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10.4 9.9v4.2l3.4-2.1z" fill="currentColor" />
    </svg>
  );
}

interface ArtPlaceholderProps {
  readonly title: string;
  readonly className?: string;
  /** Extra class on the monogram so the poster path keeps its `.poster__initials`
   * hook (hero sizing, e2e) while the shared `.art-ph__label` base still applies. */
  readonly labelClassName?: string;
}

/**
 * The single designed no-artwork mark. With the TMDB key blank every
 * poster resolves here, so it must read as intentional: a quiet media glyph and the
 * title's monogram in the display face — never a broken-image icon or a flat grey
 * void. Rendered as an absolute fill so it overlays the hosting media surface
 * (poster frame / still), which owns the deterministic warm {@link artGradient}
 * backing — the same convention the episode hero backdrop uses. Reused by the
 * Poster tile and the season/next-up Still — one mark, everywhere posters render.
 */
export function ArtPlaceholder({
  title,
  className,
  labelClassName,
}: ArtPlaceholderProps): ReactElement {
  return (
    <span className={`art-ph${className === undefined ? "" : ` ${className}`}`} aria-hidden="true">
      <MediaGlyph />
      <span className={`art-ph__label${labelClassName === undefined ? "" : ` ${labelClassName}`}`}>
        {initialsOf(title)}
      </span>
    </span>
  );
}
