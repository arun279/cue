import { resolvePoster, type TmdbImageConfig } from "@data/image-source";
import { type ReactElement, useState } from "react";

type PosterVariant = "row" | "queue" | "hero";

interface PosterProps {
  readonly title: string;
  readonly posters?: readonly string[] | null;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly variant?: PosterVariant;
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A stable, warm dark gradient derived from the title so the art-missing tile is
 * never the flat grey monogram that read as "unstyled template". Ivory
 * initials with a soft shadow keep legibility over any hue.
 */
function gradientFor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(150deg, hsl(${hue} 42% 22%), hsl(${(hue + 40) % 360} 38% 13%))`;
}

/**
 * Poster tile via the image resolver (Trakt inline → TMDB → gradient
 * fallback). A URL that fails to load degrades to the same gradient-initials tile
 * with a retry chip, so a broken image never leaves a torn card. The `variant` sizes the tile for its context (queue row, hero
 * inset, list row); progress rails are drawn by the consumer wrapper.
 */
export function Poster({ title, posters, tmdbConfig, variant = "row" }: PosterProps): ReactElement {
  const [broken, setBroken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const resolved = resolvePoster({ title, traktPosters: posters, tmdbConfig });

  if (resolved.source === "placeholder" || broken) {
    return (
      <div
        className={`poster poster--text poster--${variant}`}
        data-testid="poster-text"
        style={{ background: gradientFor(title) }}
      >
        <span className="poster__initials" aria-hidden="true">
          {initials(title)}
        </span>
        {broken && (
          <button
            type="button"
            className="poster__retry"
            data-testid="poster-retry"
            aria-label={`Retry loading poster for ${title}`}
            onClick={() => {
              setBroken(false);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <img
      key={attempt}
      className={`poster poster--${variant}`}
      src={resolved.url}
      alt=""
      loading="lazy"
      decoding="async"
      data-testid="poster-image"
      onError={() => setBroken(true)}
    />
  );
}
