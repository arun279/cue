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
 * below-the-fold tile in a browse or library grid reads as the designed
 * no-artwork block rather than a flat grey blank (Rams #8). A URL that fails
 * to load degrades silently to the same block, so a broken image never leaves a
 * torn card or adds a nested control inside linked tiles. The `variant` picks the
 * tile's step on the 2:3 size
 * scale; progress rails are drawn by the consumer wrapper.
 */
function PosterImage({ url }: { readonly url: string }): ReactElement | null {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (broken) return null;
  return (
    <img
      className={`poster__img${loaded ? " poster__img--loaded" : ""}`}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      data-testid="poster-image"
      onLoad={() => setLoaded(true)}
      onError={() => setBroken(true)}
    />
  );
}

export function Poster({ title, posters, variant }: PosterProps): ReactElement {
  const resolved = resolvePoster({ title, traktPosters: posters });
  // Null when there is no resolvable art: the tile stays the placeholder block with
  // no image layer.
  const url = resolved.source === "placeholder" ? null : resolved.url;
  return (
    <div
      className={`poster poster--${variant}`}
      data-testid={url === null ? "poster-text" : "poster-frame"}
      style={{ background: artGradient(title) }}
    >
      <ArtPlaceholder title={title} labelClassName="poster__initials" />
      {url !== null && <PosterImage key={url} url={url} />}
    </div>
  );
}
