import { resolvePoster, type TmdbImageConfig } from "@data/image-source";
import { type ReactElement, useState } from "react";

type PosterVariant = "row" | "queue" | "hero" | "tile";

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
 * fallback). The gradient-initials tile is ALWAYS the backing layer: when a poster
 * URL resolves, the `<img>` sits on top and fades in once it decodes, so a
 * lazy below-the-fold tile in a discover / library grid reads as a warm, titled
 * placeholder rather than a flat grey blank (Rams #8). A URL that fails to load degrades to the same tile with a retry chip, so a
 * broken image never leaves a torn card. The `variant` sizes the tile for its
 * context (queue row, hero inset, list row); progress rails are drawn by the
 * consumer wrapper.
 */
export function Poster({ title, posters, tmdbConfig, variant = "row" }: PosterProps): ReactElement {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolved = resolvePoster({ title, traktPosters: posters, tmdbConfig });
  // Null when there is no resolvable art: the tile stays the gradient-initials
  // placeholder with no image layer.
  const url = resolved.source === "placeholder" ? null : resolved.url;
  // Scope "broken" to the exact URL that failed, not a bare boolean: if this tile
  // instance is later reused (same key, new props) and resolves a *different*
  // poster, the new art gets a fresh load instead of inheriting the old failure.
  const isBroken = url !== null && brokenSrc === url;
  const showImage = url !== null && !isBroken;

  return (
    <div
      className={`poster poster--text poster--${variant}`}
      data-testid={showImage ? "poster-frame" : "poster-text"}
      style={{ background: gradientFor(title) }}
    >
      <span className="poster__initials" aria-hidden="true">
        {initials(title)}
      </span>
      {showImage && (
        // Tie the loaded flag to the URL that loaded, not a bare boolean: a reused
        // tile (same key, new props) that swaps to a different poster must re-show
        // the placeholder until the new image decodes, not inherit the old "loaded".
        <img
          key={attempt}
          className={`poster__img${loadedSrc === url ? " poster__img--loaded" : ""}`}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          data-testid="poster-image"
          onLoad={() => setLoadedSrc(url)}
          onError={() => setBrokenSrc(url)}
        />
      )}
      {isBroken && (
        <button
          type="button"
          className="poster__retry"
          data-testid="poster-retry"
          aria-label={`Retry loading poster for ${title}`}
          onClick={() => {
            setBrokenSrc(null);
            setLoadedSrc(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
