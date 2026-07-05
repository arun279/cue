/**
 * Pluggable image resolution: Trakt inline poster → TMDB (when
 * configured) → initials placeholder. A missing/low-res Trakt image degrades
 * gracefully instead of rendering a broken tile. Trakt image URLs are
 * host-relative (`media.trakt.tv/...`); TMDB URLs are built from the cached
 * `/3/configuration` base + size tier.
 */

export interface TmdbImageConfig {
  readonly secureBaseUrl: string;
  readonly posterSize: string;
}

export interface PosterInput {
  readonly title: string;
  readonly traktPosters?: readonly string[] | null;
  readonly tmdbPath?: string | null;
  readonly tmdbConfig?: TmdbImageConfig | null;
}

export type ResolvedImage =
  | { readonly source: "trakt"; readonly url: string }
  | { readonly source: "tmdb"; readonly url: string }
  | { readonly source: "placeholder"; readonly initials: string };

export function resolvePoster(input: PosterInput): ResolvedImage {
  const traktPoster = input.traktPosters?.find((url) => url.length > 0);
  if (traktPoster !== undefined) return { source: "trakt", url: ensureHttps(traktPoster) };
  if (
    input.tmdbPath !== undefined &&
    input.tmdbPath !== null &&
    input.tmdbPath.length > 0 &&
    input.tmdbConfig != null
  ) {
    return {
      source: "tmdb",
      url: `${input.tmdbConfig.secureBaseUrl}${input.tmdbConfig.posterSize}${input.tmdbPath}`,
    };
  }
  return { source: "placeholder", initials: initialsOf(input.title) };
}

function ensureHttps(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

function initialsOf(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
