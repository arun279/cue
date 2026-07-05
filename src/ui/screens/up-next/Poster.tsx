import { resolvePoster, type TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import { type ReactElement, useState } from "react";

interface PosterProps {
  readonly entry: LibraryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
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
 * Poster tile via the image resolver (Trakt inline → TMDB → text-only). A
 * URL that fails to load degrades to the same initials tile with a retry chip,
 * so a broken image never leaves a torn card.
 */
export function Poster({ entry, tmdbConfig }: PosterProps): ReactElement {
  const [broken, setBroken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const resolved = resolvePoster({
    title: entry.title,
    traktPosters: entry.posters,
    tmdbConfig,
  });

  if (resolved.source === "placeholder" || broken) {
    return (
      <div className="poster poster--text" data-testid="poster-text">
        <span className="poster__initials" aria-hidden="true">
          {initials(entry.title)}
        </span>
        {broken && (
          <button
            type="button"
            className="poster__retry"
            data-testid="poster-retry"
            aria-label={`Retry loading poster for ${entry.title}`}
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
      className="poster"
      src={resolved.url}
      alt=""
      loading="lazy"
      decoding="async"
      data-testid="poster-image"
      onError={() => setBroken(true)}
    />
  );
}
