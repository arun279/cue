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
}

function seasonTitle(season: SeasonView): string {
  if (season.isSpecial) return "Specials";
  return season.title ?? `Season ${season.number}`;
}

/**
 * One expandable season: a disclosure header carrying the per-season progress and
 * a "Mark season" action, and the episode list. Marking a season (or "up to
 * here" from an episode) funnels through the bulk builder, so it can never
 * mark unaired episodes; the action is disabled when the season has nothing aired
 * (or is Specials while the opt-in is off).
 */
export function SeasonPanel({ season, allSeasons, target, marks }: SeasonPanelProps): ReactElement {
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
            <span className="season__name">{seasonTitle(season)}</span>
            <span className="season__count" data-testid="season-count">
              {season.completedCount}/{season.airedCount}
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
        <ul className="episode-list">
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={`${episode.season}-${episode.number}`}
              showId={target.showId}
              episode={episode}
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
