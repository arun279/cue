import { TraktReadError } from "@cue/core/data/trakt/client";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import "./support/screen-mocks";
import { agesAgo, entry, fakeRuntime, Harness, spyHaptics } from "./support/up-next";

const Library = (
  require("../app/(tabs)/(library)/library") as typeof import("../app/(tabs)/(library)/library")
).default;

const haptics = spyHaptics();
const HARBOR = 8801;
const COASTAL = 8808;
const GLASSHOUSE = 8805;
const ADA = 8806;
const WINTER = 8807;
const LANTERN = 5501;
const STATIC = 5503;

/** One show per chip, with the two Watching shows in a different order under
 * each sort: Harbor was watched more recently, Coastal comes first in the
 * alphabet. */
function shows(): readonly LibraryEntry[] {
  return [
    entry(),
    entry({
      showId: COASTAL,
      title: "Coastal Static",
      aired: 25,
      completed: 24,
      lastWatchedAt: agesAgo(6),
    }),
    entry({ showId: GLASSHOUSE, title: "Glasshouse", hidden: true }),
    entry({
      showId: ADA,
      title: "Nine Lives of Ada Rook",
      aired: 8,
      completed: 0,
      inWatchlist: true,
      lastWatchedAt: null,
      nextEpisode: null,
    }),
    entry({
      showId: WINTER,
      title: "The Long Winter",
      status: "ended",
      aired: 10,
      completed: 10,
      nextEpisode: null,
    }),
  ];
}

function movie(overrides: Partial<MovieEntry> = {}): MovieEntry {
  return {
    movieId: LANTERN,
    ids: { trakt: LANTERN },
    title: "The Lantern Keeper",
    year: 2021,
    watched: true,
    watchedAt: agesAgo(12),
    inWatchlist: false,
    listedAt: null,
    posters: [],
    tmdbId: null,
    ...overrides,
  };
}

const movies = (): readonly MovieEntry[] => [
  movie(),
  movie({
    movieId: STATIC,
    title: "Salt and Static",
    year: 2024,
    watched: false,
    watchedAt: null,
    inWatchlist: true,
    listedAt: agesAgo(3),
  }),
];

interface Options {
  readonly entries?: readonly LibraryEntry[];
  readonly loadUpNext?: () => Promise<never>;
}

async function paint({ entries = shows(), loadUpNext }: Options = {}): Promise<void> {
  const runtime = {
    ...fakeRuntime({ entries, movies: movies() }),
    ...(loadUpNext === undefined ? null : { loadUpNext }),
  };
  await render(
    <Harness runtime={runtime} haptics={haptics}>
      <Library />
    </Harness>,
  );
  await waitFor(() => expect(screen.queryByTestId("library-skeleton")).toBeNull());
  // The movie read lands after the library one, and a query settling past the
  // end of a case is what leaves an update outside act.
  await act(async () => {});
}

const titles = (): (string | undefined)[] =>
  screen.getAllByTestId(/^(show|movie)-card-/).map((tile) => labelOf(tile).split(",")[0]);

const labelOf = (element: { props: Record<string, unknown> }): string =>
  String(element.props["accessibilityLabel"]);

afterEach(() => jest.clearAllMocks());

it("opens on Watching, with a count on every chip", async () => {
  await paint();

  expect(labelOf(screen.getByTestId("library-chip-watching"))).toBe("Watching, 2");
  expect(labelOf(screen.getByTestId("library-chip-watchlist"))).toBe("Watchlist, 1");
  expect(labelOf(screen.getByTestId("library-chip-stopped"))).toBe("Stopped, 1");
  expect(labelOf(screen.getByTestId("library-chip-finished"))).toBe("Finished, 1");
  expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]);
  expect(labelOf(screen.getByTestId(`show-card-${HARBOR}`))).toBe(
    "Harbor Lights, watching, 3 episodes left",
  );
});

it("shows the chip's own slice of the library", async () => {
  await paint();

  await userEvent.press(screen.getByTestId("library-chip-stopped"));

  expect(titles()).toEqual(["Glasshouse"]);
  expect(haptics.selection).toHaveBeenCalled();
});

it("remembers a chip per segment", async () => {
  await paint();
  await userEvent.press(screen.getByTestId("library-chip-stopped"));

  await userEvent.press(screen.getByTestId("library-segment-movies"));
  expect(titles()).toEqual(["Salt and Static"]);
  await userEvent.press(screen.getByTestId("library-chip-watched"));
  expect(titles()).toEqual(["The Lantern Keeper"]);

  await userEvent.press(screen.getByTestId("library-segment-shows"));
  expect(titles()).toEqual(["Glasshouse"]);

  await userEvent.press(screen.getByTestId("library-segment-movies"));
  expect(titles()).toEqual(["The Lantern Keeper"]);
});

it("reorders the grid from the sort menu", async () => {
  await paint();

  await userEvent.press(screen.getByTestId("sort-alphabetical"));

  expect(titles()).toEqual(["Coastal Static", "Harbor Lights"]);
});

it("offers the medium's own sort options", async () => {
  await paint();
  expect(screen.queryByTestId("sort-progress")).not.toBeNull();

  await userEvent.press(screen.getByTestId("library-segment-movies"));

  expect(screen.queryByTestId("sort-progress")).toBeNull();
  expect(screen.getByText("Recently added")).toBeTruthy();
});

it("filters on the settled query and clears back to the grid", async () => {
  await paint();
  await userEvent.press(screen.getByTestId("library-filter-toggle"));

  await userEvent.type(screen.getByTestId("library-filter-field"), "coast");
  await waitFor(() => expect(titles()).toEqual(["Coastal Static"]));

  await userEvent.clear(screen.getByTestId("library-filter-field"));
  await userEvent.type(screen.getByTestId("library-filter-field"), "wire");
  await waitFor(() => expect(screen.queryByTestId("library-no-match")).not.toBeNull());
  expect(screen.getByText('No shows match "wire".')).toBeTruthy();

  await userEvent.press(screen.getByTestId("library-filter-clear"));
  await waitFor(() => expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]));
});

it("says what each empty chip is for", async () => {
  await paint({ entries: [entry()] });

  await userEvent.press(screen.getByTestId("library-chip-watchlist"));
  expect(screen.getByText("Things you want to watch land here.")).toBeTruthy();
  expect(screen.getByText("Add them from Search.")).toBeTruthy();

  await userEvent.press(screen.getByTestId("library-chip-stopped"));
  expect(screen.getByText("Shows you stop keep their progress.")).toBeTruthy();
  expect(screen.getByText("Resume any time.")).toBeTruthy();

  await userEvent.press(screen.getByTestId("library-chip-finished"));
  expect(screen.getByText("Shows you finish land here.")).toBeTruthy();
});

it("offers Search from an empty Watching chip", async () => {
  await paint({ entries: [] });

  expect(screen.getByText("Shows you're watching land here.")).toBeTruthy();
  expect(screen.getByText("Find one in Search.")).toBeTruthy();
  expect(screen.getByText("Search shows")).toBeTruthy();
});

it("names the two movie chips", async () => {
  await paint();

  await userEvent.press(screen.getByTestId("library-segment-movies"));

  expect(labelOf(screen.getByTestId("library-chip-watchlist"))).toBe("Watchlist, 1");
  expect(labelOf(screen.getByTestId("library-chip-watched"))).toBe("Watched, 1");
  expect(screen.queryByTestId("library-chip-stopped")).toBeNull();
});

it("holds the grid's shape while it loads", async () => {
  await render(
    <Harness
      runtime={{ ...fakeRuntime({}), loadUpNext: () => new Promise(() => {}) }}
      haptics={haptics}
    >
      <Library />
    </Harness>,
  );

  expect(screen.getByTestId("library-skeleton")).toBeTruthy();
});

it("offers Retry when the library cannot be read", async () => {
  await paint({
    loadUpNext: () => Promise.reject(new TraktReadError({ kind: "network" }, "your library")),
  });

  expect(screen.getByText("Couldn't load your library")).toBeTruthy();
  expect(screen.getByTestId("library-error-retry")).toBeTruthy();
});
