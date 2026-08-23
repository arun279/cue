import type { EpisodeView, SeasonView } from "@cue/core/data/trakt/show-detail";
import { epCode } from "@cue/core/domain/model/library";
import { CheckControl } from "@ui/components/CheckControl";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { ProgressBar } from "@ui/components/ProgressBar";
import { formatAirDate } from "@cue/core/format";
import { Check, ChevronDown } from "lucide-react";
import { Accordion } from "radix-ui";
import type { ReactElement } from "react";
import { monthDayChip, seasonCheckFacts } from "./detail-logic";

interface SeasonListProps {
  readonly showId: number;
  readonly seasons: readonly SeasonView[];
  /** Accordion value (`s2`) to auto-expand: the show's current season. */
  readonly defaultOpen: string | undefined;
  onSeasonCheck(season: SeasonView): void;
  onEpisodeToggle(season: SeasonView, episode: EpisodeView): void;
}

function seasonTitle(season: SeasonView): string {
  if (season.isSpecial) return "Specials";
  return season.title ?? `Season ${season.number}`;
}

function EpisodeItem({
  showId,
  episode,
  onToggle,
}: {
  readonly showId: number;
  readonly episode: EpisodeView;
  onToggle(): void;
}): ReactElement {
  const code = epCode(episode.season, episode.number);
  const name = episode.title ?? code;
  const air = formatAirDate(episode.firstAired);
  return (
    <li>
      <EpisodeRow
        variant="season"
        testId="episode-row"
        art={<span className="ep-row__num">{episode.number}</span>}
        title={
          <span className="season-ep__title" data-watched={episode.watched}>
            {episode.watched && <Check className="season-ep__done" aria-hidden="true" />}
            {name}
          </span>
        }
        {...(air === null ? {} : { meta: air })}
        trailing={
          episode.aired ? (
            <CheckControl
              size={44}
              state={episode.watched ? "watched" : "unwatched"}
              label={episode.watched ? "Watched. Tap to remove." : `Mark ${code} ${name} watched`}
              testId="episode-check"
              onPress={onToggle}
            />
          ) : (
            <CheckControl
              state="unaired"
              label=""
              testId="episode-unaired"
              unairedDate={monthDayChip(episode.firstAired)}
            />
          )
        }
        link={{
          to: "/show/$showId/episode/$season/$episode",
          params: {
            showId: String(showId),
            season: String(episode.season),
            episode: String(episode.number),
          },
        }}
        linkLabel={`${code} ${name}${air === null ? "" : `, ${air}`}`}
      />
    </li>
  );
}

/**
 * The seasons accordion: 56px header rows with name, watched count, a
 * 48×4 bar, the season bulk check (hollow / partial-dot / filled → confirm
 * flows), and chevron, expanding in place into 56px episode rows. No season
 * sub-pages: one page keeps the mark loop fast.
 */
export function SeasonList({
  showId,
  seasons,
  defaultOpen,
  onSeasonCheck,
  onEpisodeToggle,
}: SeasonListProps): ReactElement {
  return (
    <Accordion.Root
      type="multiple"
      defaultValue={defaultOpen === undefined ? [] : [defaultOpen]}
      className="season-list"
      data-testid="season-list"
    >
      {seasons.map((season) => {
        const { airedDone, complete, partial } = seasonCheckFacts(season);
        const title = seasonTitle(season);
        return (
          <Accordion.Item
            key={season.number}
            value={`s${season.number}`}
            className="season"
            data-testid="season-panel"
            data-season={season.number}
          >
            <div className="season__row">
              <Accordion.Header className="season__heading">
                <Accordion.Trigger className="season__trigger" data-testid="season-trigger">
                  <span className="season__name">{title}</span>
                  <span className="season__meta">
                    <span className="season__count" data-testid="season-count">
                      {airedDone}/{season.airedCount}
                    </span>
                    <ProgressBar
                      percent={season.airedCount > 0 ? (airedDone / season.airedCount) * 100 : 0}
                      className="season__bar"
                    />
                  </span>
                  <ChevronDown className="season__chevron" aria-hidden="true" />
                </Accordion.Trigger>
              </Accordion.Header>
              {season.airedCount > 0 && (
                <CheckControl
                  size={44}
                  state={complete ? "watched" : "unwatched"}
                  partial={partial}
                  label={complete ? `Unmark ${title}` : `Mark ${title} watched`}
                  testId="season-check"
                  onPress={() => onSeasonCheck(season)}
                />
              )}
            </div>
            <Accordion.Content className="season__content">
              <ul className="season__episodes">
                {season.episodes.map((episode) => (
                  <EpisodeItem
                    key={`${episode.season}-${episode.number}`}
                    showId={showId}
                    episode={episode}
                    onToggle={() => onEpisodeToggle(season, episode)}
                  />
                ))}
              </ul>
            </Accordion.Content>
          </Accordion.Item>
        );
      })}
    </Accordion.Root>
  );
}
