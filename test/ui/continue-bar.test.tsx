import type { LibraryEntry } from "@data/trakt/library";
import type { ShowHeader } from "@data/trakt/show-detail";
import { ContinueBar } from "@ui/screens/show-detail/ContinueBar";
import { act, type ReactNode } from "react";
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
  showId: 1,
  ids: { trakt: 1 },
  title: "Budget Tail",
  year: 2024,
  status: "returning series",
  network: null,
  genres: [],
  overview: null,
  posters: [],
  backdrops: [],
  tmdbId: null,
  aired: 10,
  completed: 4,
  lastWatchedAt: "2026-06-01T00:00:00.000Z",
  nextEpisode,
};

const entry: LibraryEntry = {
  showId: 1,
  title: "Budget Tail",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-06-01T00:00:00.000Z",
  aired: 4,
  completed: 4,
  nextEpisode: null,
  progressKnown: false,
  posters: [],
  backdrops: [],
  network: null,
  genres: [],
  runtime: null,
  tmdbId: null,
  pendingAdvance: false,
};

it("uses loaded header progress and the fallback mark for a budget-tail entry", () => {
  const onFallbackMark = vi.fn();
  mount(
    <ContinueBar
      showId={1}
      header={header}
      entry={entry}
      mark={{} as never}
      onFallbackMark={onFallbackMark}
    />,
  );

  const bar = document.querySelector<HTMLElement>('[data-testid="continue-bar"]');
  const check = document.querySelector<HTMLButtonElement>('[data-testid="continue-check"]');
  expect(bar).toHaveAttribute("data-variant", "next");
  expect(bar).toHaveTextContent("Next");
  expect(bar).toHaveTextContent("S2 E3");
  expect(check).toHaveAttribute("data-state", "unwatched");
  expect(check).not.toHaveAttribute("aria-disabled");

  act(() => check?.click());
  expect(onFallbackMark).toHaveBeenCalledTimes(1);
});
