import type { SeasonView } from "@data/trakt/show-detail";
import type {
  EpisodeBound,
  MarkContextTarget,
  MarkSeasonController,
} from "@ui/hooks/useMarkSeason";
import { Accordion } from "radix-ui";
import type { ReactElement } from "react";
import { EpisodeRow } from "./EpisodeRow";

interface SeasonPanelProps {
  readonly season: SeasonView;
  readonly allSeasons: readonly SeasonView[];
  readonly target: MarkContextTarget;
  readonly marks: MarkSeasonController;
  /** `season:number` of the show's next episode, so the shelf can flag it. */
  readonly nextKey: string | null;
}

function seasonTitle(season: SeasonView): string {
  if (season.isSpecial) return "Specials";
  return season.title ?? `Season ${season.number}`;
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** A completion ring reading `done/aired` — the season-shelf progress glyph.
 * `done` is clamped to the aired basis so a watched *unaired* special can never
 * render an over-full "9/8" label against a "complete" subtitle. */
function CompletionRing({ done, aired }: { done: number; aired: number }): ReactElement {
  const airedDone = Math.min(done, aired);
  const ratio = aired > 0 ? airedDone / aired : 0;
  return (
    <span className="season__ring" data-complete={aired > 0 && airedDone >= aired}>
      <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="season__ring-track" cx="18" cy="18" r={RING_R} />
        <circle
          className="season__ring-fill"
          cx="18"
          cy="18"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - ratio)}
        />
      </svg>
      <span className="season__ring-label" data-testid="season-count">
        {airedDone}/{aired}
      </span>
    </span>
  );
}

function subtitle(season: SeasonView): string {
  const total = season.episodes.length;
  // Reconcile with the ring, which reads done/aired: when episodes are still
  // unaired (common on Specials) show the aired basis so "8 of 10 aired" matches
  // the ring's 8, never a bare "10 episodes" that contradicts a 0/8 ring.
  const count =
    season.airedCount < total
      ? `${season.airedCount} of ${total} aired`
      : `${total} episode${total === 1 ? "" : "s"}`;
  // Clamp to the aired basis (matching the ring) so a watched unaired special never
  // reads "9 watched" / "complete" against an 8-episode aired count.
  const watched = Math.min(season.completedCount, season.airedCount);
  if (watched === 0) return `${count} · not started`;
  if (season.airedCount > 0 && watched >= season.airedCount) {
    return `${count} · complete`;
  }
  return `${count} · ${watched} watched`;
}

/**
 * One expandable season shelf: a disclosure header carrying the completion ring,
 * count, and a "Mark season" action, expanding into a horizontal shelf of episode
 * stills. Marking a season (or "up to here" from an episode) funnels through the
 * bulk builder, so it can never mark unaired episodes; the action is disabled
 * when the season has nothing aired (or is Specials while the opt-in is off).
 */
export function SeasonPanel({
  season,
  allSeasons,
  target,
  marks,
  nextKey,
}: SeasonPanelProps): ReactElement {
  const canMark = season.airedCount > 0 && (!season.isSpecial || target.includeSpecials);
  const markUpToHere = (bound: EpisodeBound): void => {
    void marks.markUpToHere(target, allSeasons, bound);
  };

  return (
    <Accordion.Item
      className="season"
      value={`s${season.number}`}
      data-testid="season-panel"
      data-season={season.number}
    >
      <div className="season__head">
        <Accordion.Header className="season__heading">
          <Accordion.Trigger className="season__trigger" data-testid="season-trigger">
            <CompletionRing done={season.completedCount} aired={season.airedCount} />
            <span className="season__name">
              {seasonTitle(season)}
              <small className="season__sub">{subtitle(season)}</small>
            </span>
            <svg
              className="season__chevron"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Accordion.Trigger>
        </Accordion.Header>
        <button
          type="button"
          className="button button--ghost button--sm"
          data-testid="mark-season"
          disabled={!canMark}
          onClick={() => void marks.markSeason(target, season)}
        >
          Mark season
        </button>
      </div>
      <Accordion.Content className="season__content">
        <ul className="stills-shelf">
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={`${episode.season}-${episode.number}`}
              showId={target.showId}
              episode={episode}
              isNext={nextKey === `${episode.season}:${episode.number}`}
              onToggle={() => void marks.toggleEpisode(target, episode)}
              onMarkUpToHere={() =>
                markUpToHere({ season: episode.season, number: episode.number })
              }
            />
          ))}
        </ul>
      </Accordion.Content>
    </Accordion.Item>
  );
}
