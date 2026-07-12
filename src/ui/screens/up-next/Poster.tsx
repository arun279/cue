import { resolvePoster } from "@data/image-source";
import { ArtPlaceholder } from "@ui/components/ArtPlaceholder";
import { artGradient } from "@ui/components/artGradient";
import { type ReactElement, useState } from "react";

/** The strict 2:3 size scale (`sNN` = NN px wide). */
type PosterVariant = "s32" | "s40" | "s44" | "s48" | "s64" | "s96" | "s115";

interface PosterProps {
  readonly title: string;
  readonly posters?: readonly string[] | null;
  readonly variant: PosterVariant;
}

/**
 * Poster tile via the image resolver (Trakt inline → placeholder). The
 * shared {@link ArtPlaceholder} is ALWAYS the backing layer: when a poster URL
 * resolves, the `<img>` sits on top and fades in once it decodes, so a lazy
 * below-the-fold tile in a discover / library grid reads as the designed
 * no-artwork block rather than a flat grey blank (Rams #8). A URL that fails
 * to load degrades to the same block with a retry chip, so a broken image never
 * leaves a torn card. The `variant` picks the tile's step on the 2:3 size
 * scale; progress rails are drawn by the consumer wrapper.
 */
export function Poster({ title, posters, variant }: PosterProps): ReactElement {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolved = resolvePoster({ title, traktPosters: posters });
  // Null when there is no resolvable art: the tile stays the placeholder block with
  // no image layer.
  const url = resolved.source === "placeholder" ? null : resolved.url;
  // Scope "broken" to the exact URL that failed, not a bare boolean: if this tile
  // instance is later reused (same key, new props) and resolves a *different*
  // poster, the new art gets a fresh load instead of inheriting the old failure.
  const isBroken = url !== null && brokenSrc === url;
  const showImage = url !== null && !isBroken;

  return (
    <div
      className={`poster poster--${variant}`}
      data-testid={showImage ? "poster-frame" : "poster-text"}
      style={{ background: artGradient(title) }}
    >
      <ArtPlaceholder title={title} labelClassName="poster__initials" />
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
