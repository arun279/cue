import { resolveBackdrop } from "@cue/core/data/image-source";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { EpisodeRef } from "@cue/core/domain/model/library";
import { epCode } from "@cue/core/domain/model/library";
import { toMs } from "@cue/core/domain/time";
import { Link } from "@tanstack/react-router";
import { artGradient } from "@ui/components/artGradient";
import { CheckControl, type CheckState } from "@ui/components/CheckControl";
import { ProgressBar } from "@ui/components/ProgressBar";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useShowArt } from "@ui/hooks/useShowArt";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

const AIRED_LAST_NIGHT_MS = 24 * 60 * 60 * 1000;

interface MarqueeCardProps {
  readonly entry: LibraryEntry;
  readonly episode: EpisodeRef;
  readonly checkState: CheckState;
  readonly checkLabel: string;
  onCheck(): void;
}

/**
 * The one card on the home screen: the top-of-queue show over its SHOW backdrop
 * (never the episode still because stills are spoilers), under a scrim for text, with the
 * 56px check trailing. Rendered only when the queue holds ≥3 shows; the caller
 * owns that rule. Backdrop missing → the monogram gradient with a 64×96 poster
 * standing in at the left, same text stack.
 */
export function MarqueeCard({
  entry,
  episode,
  checkState,
  checkLabel,
  onCheck,
}: MarqueeCardProps): ReactElement {
  // Art is deferred out of the cold-sync budget: the card reads its own backdrop
  // once it settles on screen.
  const art = useShowArt(entry.showId);
  const backdrop = resolveBackdrop(art.backdrops);
  const airedMs = toMs(episode.firstAired);
  const now = Date.now();
  const airedLastNight = airedMs !== null && now - airedMs <= AIRED_LAST_NIGHT_MS && airedMs <= now;
  const code = epCode(episode.season, episode.number);
  const left = episodesLeft(entry.aired, entry.completed);

  return (
    <article
      ref={art.ref}
      className="marquee"
      data-testid="marquee-card"
      data-show-id={entry.showId}
    >
      {backdrop === null ? (
        <span
          className="marquee__plate"
          style={{ background: artGradient(entry.title) }}
          aria-hidden="true"
        />
      ) : (
        <img className="marquee__backdrop" src={backdrop} alt="" aria-hidden="true" />
      )}
      <span className="marquee__scrim" aria-hidden="true" />
      <Link
        to="/show/$showId"
        params={{ showId: String(entry.showId) }}
        className="marquee__body"
        aria-label={entry.title}
      >
        {backdrop === null && (
          <span className="marquee__poster">
            <Poster title={entry.title} posters={art.posters} variant="s64" />
          </span>
        )}
        <span className="marquee__stack">
          <span className="marquee__eyebrow">
            {airedLastNight ? "Aired last night" : "Continue"}
          </span>
          <span className="marquee__title">{entry.title}</span>
          <span className="marquee__meta">
            {code}
            {episode.title !== null && ` · ${episode.title}`}
          </span>
          <span className="marquee__progress">
            <ProgressBar percent={watchedPercent(entry.completed, entry.aired)} />
            <span className="marquee__left">{left} left</span>
          </span>
        </span>
      </Link>
      <span className="marquee__check">
        <CheckControl
          state={checkState}
          size={56}
          mode="advance"
          label={checkLabel}
          onPress={onCheck}
        />
      </span>
    </article>
  );
}
