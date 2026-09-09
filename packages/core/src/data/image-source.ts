/**
 * Image resolution: a Trakt inline poster (host-relative `media.trakt.tv/...`)
 * when present, else the initials placeholder. A missing/low-res image degrades
 * to the monogram block instead of rendering a broken tile.
 */

export interface PosterInput {
  readonly title: string;
  readonly traktPosters?: readonly string[] | null;
}

export type ResolvedImage =
  | { readonly source: "trakt"; readonly url: string }
  | { readonly source: "placeholder"; readonly initials: string };

export function resolvePoster(input: PosterInput): ResolvedImage {
  const traktPoster = input.traktPosters?.find((url) => url.length > 0);
  if (traktPoster !== undefined) return { source: "trakt", url: ensureHttps(traktPoster) };
  return { source: "placeholder", initials: initialsOf(input.title) };
}

/** First usable candidate as an https URL; null means "use the monogram block". */
function firstUrl(candidates: readonly string[] | null | undefined): string | null {
  const url = candidates?.find((candidate) => candidate.length > 0);
  return url === undefined ? null : ensureHttps(url);
}

/** An episode's 16:9 still from its `images.screenshot` candidates. */
export function resolveStill(screenshots: readonly string[] | null | undefined): string | null {
  return firstUrl(screenshots);
}

/** A show/movie 16:9 backdrop from its `images.fanart` candidates. */
export function resolveBackdrop(fanart: readonly string[] | null | undefined): string | null {
  return firstUrl(fanart);
}

function ensureHttps(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

/** The 1-2 letter monogram for a title, shared by the placeholder resolver and the
 * designed no-artwork block so both derive the same initials from a title. */
export function initialsOf(title: string): string {
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

/** The hue a title's no-artwork plate is tinted with, so both apps derive the
 * same color for the same show and a placeholder reads as deliberate rather
 * than as a flat grey void. */
export function artHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}
