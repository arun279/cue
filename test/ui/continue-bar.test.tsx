import type { LibraryEntry } from "@data/trakt/library";
import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import { ContinueBar } from "@ui/screens/show-detail/ContinueBar";
import { act, type ReactElement, type ReactNode, useState } from "react";
import { expect, it, vi } from "vitest";
import { mount } from "./_mount";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => (
    <a href="/show/1" className={className}>
      {children}
    </a>
  ),
}));

const nextEpisode = {
  season: 2,
  number: 3,
  title: "The Return",
  firstAired: "2026-07-01T00:00:00.000Z",
  ids: { trakt: 203 },
  stills: [],
  watched: false,
  watchedAt: null,
  aired: true,
} as const;

const header: ShowHeader = {
  ids: { trakt: 1 },
  title: "Budget Tail",
  year: 2024,
  status: "returning series",
  network: null,
  genres: [],
  runtime: null,
  overview: null,
  posters: [],
  backdrops: [],
  aired: 10,
  completed: 4,
  nextEpisode,
};

const entry: LibraryEntry = {
  showId: 1,
  title: "Budget Tail",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-06-01T00:00:00.000Z",
  aired: 10,
  completed: 4,
  nextEpisode: null,
  lastAired: null,
  tmdbId: null,
  pendingAdvance: false,
};

function queryBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="continue-bar"]');
}

function queryCheck(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-testid="continue-check"]');
}

function renderBar(props: {
  readonly header: ShowHeader;
  readonly entry: LibraryEntry | undefined;
  readonly onFallbackMark: (episode: EpisodeView) => void;
}): { readonly bar: HTMLElement | null; readonly check: HTMLButtonElement | null } {
  mount(
    <ContinueBar
      showId={1}
      header={props.header}
      entry={props.entry}
      seasons={[]}
      mark={{} as never}
      onFallbackMark={props.onFallbackMark}
    />,
  );
  return { bar: queryBar(), check: queryCheck() };
}

it("uses loaded header progress and the fallback mark for a budget-tail entry", () => {
  const onFallbackMark = vi.fn();
  const { bar, check } = renderBar({ header, entry, onFallbackMark });
  expect(bar).toHaveAttribute("data-variant", "next");
  expect(bar).toHaveTextContent("Next");
  expect(bar).toHaveTextContent("S2 E3");
  expect(check).toHaveAttribute("data-state", "unwatched");
  expect(check).not.toHaveAttribute("aria-disabled");

  act(() => check?.click());
  expect(onFallbackMark).toHaveBeenCalledWith(nextEpisode);
});

it("uses header progress for a never-watched watchlist placeholder", () => {
  const first = { ...nextEpisode, season: 1, number: 1, title: "Pilot", ids: { trakt: 101 } };
  const startHeader: ShowHeader = {
    ...header,
    aired: 6,
    completed: 0,
    nextEpisode: first,
  };
  const placeholder: LibraryEntry = {
    ...entry,
    inWatchlist: true,
    lastWatchedAt: null,
    aired: 0,
    completed: 0,
    nextEpisode: null,
  };
  const onFallbackMark = vi.fn();
  const { bar, check } = renderBar({ header: startHeader, entry: placeholder, onFallbackMark });
  expect(bar).toHaveAttribute("data-variant", "next");
  expect(bar).toHaveTextContent("Start watching");
  expect(bar).toHaveTextContent("S1 E1");
  expect(bar).toHaveTextContent("6 episodes");
  expect(check).toHaveAttribute("data-state", "unwatched");

  act(() => check?.click());
  expect(onFallbackMark).toHaveBeenCalledWith(first);
});

function seasonEpisode(number: number, watched: boolean): EpisodeView {
  return {
    season: 1,
    number,
    title: `Episode ${number}`,
    firstAired: "2026-01-01T00:00:00.000Z",
    ids: { trakt: 100 + number },
    stills: [],
    watched,
    watchedAt: watched ? "2026-07-01T00:00:00.000Z" : null,
    aired: true,
  };
}

function fallbackSeason(episodes: readonly EpisodeView[]): SeasonView {
  return {
    number: 1,
    title: "Season 1",
    isSpecial: false,
    isHidden: false,
    episodes,
    airedCount: episodes.length,
    completedCount: episodes.filter((episode) => episode.watched).length,
  };
}

it("advances and rolls back fallback progress from the optimistic seasons tree", () => {
  const initial = fallbackSeason([
    seasonEpisode(1, true),
    seasonEpisode(2, false),
    seasonEpisode(3, false),
  ]);
  const onFallbackMark = vi.fn();
  let rollback = (): void => undefined;

  function Harness(): ReactElement {
    const [seasons, setSeasons] = useState<readonly SeasonView[]>([initial]);
    rollback = () => setSeasons([initial]);
    return (
      <ContinueBar
        showId={1}
        header={{ ...header, completed: 0, nextEpisode: seasonEpisode(1, false) }}
        entry={entry}
        seasons={seasons}
        mark={{} as never}
        onFallbackMark={(episode) => {
          onFallbackMark(episode);
          setSeasons((current) =>
            current.map((season) =>
              fallbackSeason(
                season.episodes.map((candidate) =>
                  candidate.number === episode.number ? { ...candidate, watched: true } : candidate,
                ),
              ),
            ),
          );
        }}
      />
    );
  }

  mount(<Harness />);
  expect(queryBar()).toHaveTextContent("S1 E2");
  expect(queryBar()).toHaveTextContent("1 of 3 watched · 2 left");

  act(() => queryCheck()?.click());
  expect(onFallbackMark).toHaveBeenLastCalledWith(expect.objectContaining({ number: 2 }));
  expect(queryBar()).toHaveTextContent("S1 E3");
  expect(queryCheck()).toHaveAttribute("data-state", "unwatched");

  act(() => rollback());
  expect(queryBar()).toHaveTextContent("S1 E2");
  expect(queryCheck()).toHaveAttribute("data-state", "unwatched");
});
