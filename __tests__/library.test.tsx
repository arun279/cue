import { act, render, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { Platform } from "react-native";
import { TraktReadError } from "@/core/data/trakt/client";
import type { LibraryEntry } from "@/core/data/trakt/library";
import type { MovieEntry } from "@/core/data/trakt/movie-library";
import { FILTER_DEBOUNCE_MS } from "../src/screens/library/model";
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
    inCollection: false,
    addedAt: null,
    posters: [],
    tmdbId: null,
    runtime: null,
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
    addedAt: agesAgo(3),
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

const chipLabels = (): string[] => screen.getAllByTestId(/^library-chip-/).map(labelOf);

const SORT_LABELS = /^(Recently watched|Recently added|A-Z|Progress|Release year)$/;

/** The bar's sort menu: a native menu on iOS, and on Android one opened from its button. */
async function sortOptions(): Promise<string[]> {
  if (Platform.OS === "android") await userEvent.press(screen.getByTestId("library-sort"));
  return screen.getAllByLabelText(SORT_LABELS).map(labelOf);
}

async function sortBy(label: string): Promise<void> {
  await sortOptions();
  await userEvent.press(screen.getByLabelText(label));
}

async function selectedSort(): Promise<string | undefined> {
  await sortOptions();
  return screen
    .getAllByLabelText(SORT_LABELS)
    .find((option) => option.props["accessibilityState"]?.selected === true)?.props[
    "accessibilityLabel"
  ];
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it("opens on Watching, with a count on every chip", async () => {
  await paint();

  expect(chipLabels()).toEqual(["Watching, 2", "Not started, 1", "Stopped, 1", "Finished, 1"]);
  expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]);
  expect(labelOf(screen.getByTestId(`show-card-${HARBOR}`))).toBe(
    "Harbor Lights, watching, 3 episodes left",
  );
});

it("counts a tile's episodes left from the next-up episode, leaving skipped seasons out", async () => {
  await paint({
    entries: shows().map((show) =>
      show.showId === HARBOR ? { ...show, aired: 30, completed: 7, left: 13 } : show,
    ),
  });

  expect(labelOf(screen.getByTestId(`show-card-${HARBOR}`))).toBe(
    "Harbor Lights, watching, 13 episodes left",
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

it("puts the sort in the navigation bar beside the avatar, and keeps it out of the grid", async () => {
  const { Stack } = jest.requireMock<typeof import("expo-router")>("expo-router");
  await paint();

  expect(within(screen.getByTestId("library-grid")).queryByTestId("library-sort")).toBeNull();
  if (Platform.OS === "ios")
    expect(jest.mocked(Stack.Toolbar.Menu)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        testID: "library-sort",
        accessibilityLabel: "Sort",
        icon: "arrow.up.arrow.down",
      }),
      undefined,
    );
  else expect(screen.getByTestId("library-sort")).toHaveProp("accessibilityLabel", "Sort");
  expect(screen.getByRole("button", { name: "Profile" })).toBeOnTheScreen();
});

it("declares the bar again only when the sort menu changes, not while the filter is typed", async () => {
  const toolbar = jest.mocked(
    jest.requireMock<typeof import("expo-router")>("expo-router").Stack.Toolbar,
  );
  await paint();
  const declared = toolbar.mock.calls.length;

  await userEvent.setup({ delay: 400 }).type(screen.getByPlaceholderText("Filter by title"), "har");
  await act(async () => jest.advanceTimersByTime(FILTER_DEBOUNCE_MS));
  expect(toolbar.mock.calls.length).toBe(declared);

  await sortBy("A-Z");
  expect(toolbar.mock.calls.length).toBeGreaterThan(declared);
});

it("reorders the grid from the sort menu", async () => {
  await paint();

  await sortBy("A-Z");

  expect(titles()).toEqual(["Coastal Static", "Harbor Lights"]);
});

it("offers each chip its own sort options and keeps each chip's choice", async () => {
  await paint();
  await userEvent.press(screen.getByTestId("library-chip-finished"));
  await sortBy("A-Z");
  expect(await selectedSort()).toBe("A-Z");
  await userEvent.press(screen.getByTestId("library-chip-watching"));
  expect(await selectedSort()).toBe("Recently watched");
  expect(await sortOptions()).toEqual(["Recently watched", "A-Z", "Progress"]);
  await sortBy("A-Z");

  await userEvent.press(screen.getByTestId("library-chip-not-started"));
  expect(await sortOptions()).toEqual(["Recently added", "A-Z", "Release year"]);
  expect(await selectedSort()).toBe("Recently added");

  await userEvent.press(screen.getByTestId("library-chip-watching"));
  expect(await selectedSort()).toBe("A-Z");

  await userEvent.press(screen.getByTestId("library-segment-movies"));
  expect(await sortOptions()).toEqual(["Recently added", "A-Z", "Release year"]);
  expect(await selectedSort()).toBe("Recently added");
});

it("lists everything never started, newest addition first", async () => {
  const added = (showId: number, title: string, days: number) =>
    entry({
      showId,
      title,
      aired: 8,
      completed: 0,
      lastWatchedAt: null,
      nextEpisode: null,
      addedAt: agesAgo(days),
    });
  await paint({ entries: [entry(), added(1, "Older", 30), added(2, "Newer", 2)] });

  await userEvent.press(screen.getByTestId("library-chip-not-started"));

  expect(titles()).toEqual(["Newer", "Older"]);
  expect(labelOf(screen.getByTestId("show-card-2"))).toBe("Newer, not started");
});

it("stops a show from its tile's menu: long press on iOS, the more icon on Android", async () => {
  await paint({ entries: [entry()] });
  expect(screen.queryByText("Stop watching") === null).toBe(Platform.OS === "android");

  if (Platform.OS === "android") {
    await userEvent.press(screen.getByLabelText("More actions for Harbor Lights"));
  }
  await userEvent.press(screen.getByText("Stop watching"));

  expect(await screen.findByText("Harbor Lights stopped")).toBeTruthy();
});

it("offers the menu's actions to assistive technology on the tile itself", async () => {
  await paint({ entries: [entry()] });

  const tile = screen.getByTestId(`show-card-${HARBOR}`);
  expect(
    tile.props["accessibilityActions"].map((action: { label: string }) => action.label),
  ).toEqual(["Show details", "Stop watching"]);
});

it("filters on the settled query and clears the header field back to the grid", async () => {
  await paint();
  const field = screen.getByPlaceholderText("Filter by title");
  const settle = () => act(async () => jest.advanceTimersByTime(FILTER_DEBOUNCE_MS));

  await userEvent.type(field, "coast");
  expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]);
  await settle();
  expect(titles()).toEqual(["Coastal Static"]);

  await userEvent.clear(field);
  await userEvent.type(field, "wire");
  await settle();
  expect(screen.getByText('No shows match "wire".')).toBeTruthy();

  await userEvent.press(screen.getByTestId("library-filter-clear"));
  await settle();
  expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]);
  expect(field).toHaveDisplayValue("");
});

it("names the other chips the filter matches in, and switches to one, keeping the filter", async () => {
  await paint();

  await userEvent.type(screen.getByPlaceholderText("Filter by title"), "glass");
  await act(async () => jest.advanceTimersByTime(FILTER_DEBOUNCE_MS));
  expect(screen.getByText('No shows in Watching match "glass".')).toBeOnTheScreen();
  await userEvent.press(screen.getByRole("button", { name: "Show 1 in Stopped" }));

  expect(chipLabels()).toEqual(["Watching, 2", "Not started, 1", "Stopped, 1", "Finished, 1"]);
  expect(screen.getByTestId("library-chip-stopped")).toHaveProp("accessibilityState", {
    selected: true,
  });
  expect(titles()).toEqual(["Glasshouse"]);
  expect(screen.getByPlaceholderText("Filter by title")).toHaveDisplayValue("glass");
});

it("says what each empty chip is for", async () => {
  await paint({ entries: [entry()] });

  await userEvent.press(screen.getByTestId("library-chip-not-started"));
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

  expect(chipLabels()).toEqual(["Not started, 1", "Watched, 1"]);
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

it("preserves burst input while results change without reinstalling the native search header", async () => {
  const declarations = jest.spyOn(
    jest.requireMock<typeof import("expo-router")>("expo-router").Stack,
    "Screen",
  );
  try {
    await paint();
    expect(declarations).toHaveBeenCalled();
    const options = declarations.mock.calls[0]?.[0].options;
    const field = screen.getByPlaceholderText("Filter by title");
    await userEvent.setup({ delay: 400 }).type(field, "zzz");
    await act(async () => jest.advanceTimersByTime(FILTER_DEBOUNCE_MS));
    expect(field).toHaveDisplayValue("zzz");
    expect(screen.getByText('No shows match "zzz".')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^show-card-/)).toHaveLength(0);
    expect(declarations.mock.calls.length).toBeGreaterThan(1);
    for (const [props] of declarations.mock.calls) expect(props.options).toBe(options);
    await userEvent.press(screen.getByTestId("library-filter-clear"));
    await act(async () => jest.advanceTimersByTime(FILTER_DEBOUNCE_MS));
    expect(field).toHaveDisplayValue("");
    expect(titles()).toEqual(["Harbor Lights", "Coastal Static"]);
  } finally {
    declarations.mockRestore();
  }
});
