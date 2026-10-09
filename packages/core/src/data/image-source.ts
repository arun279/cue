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

function firstUrl(candidates: readonly string[] | null | undefined): string | null {
  const url = candidates?.find((candidate) => candidate.length > 0);
  return url === undefined ? null : ensureHttps(url);
}

export function resolveStill(screenshots: readonly string[] | null | undefined): string | null {
  return firstUrl(screenshots);
}

export function resolveBackdrop(fanart: readonly string[] | null | undefined): string | null {
  return firstUrl(fanart);
}

function ensureHttps(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

export function initialsOf(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function artHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}
