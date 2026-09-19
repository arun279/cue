import { TraktReadError } from "@cue/core/data/trakt/client";
import type { SearchHit } from "@cue/core/data/trakt/search";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import "./support/screen-mocks";
import { SEARCH_FIELD } from "./support/native-ui";
import { fakeRuntime, Harness, memoryPreferences, OFFLINE, spyHaptics } from "./support/up-next";

const Search = (
  require("../app/(tabs)/(search)/search") as typeof import("../app/(tabs)/(search)/search")
).default;

/** The confirmation's own duration, spelled here rather than imported, so the
 * case fails if the screen changes how long the flash holds. */
const FLASH_MS = 600;

/** How long a settled query has to stand before Search remembers it. */
const DWELL_MS = 1500;

const haptics = spyHaptics();
const HARBOR = 8801;
const MASTER = 8901;
const SOUND = 5601;
const ADDED = `search-result-${MASTER}-added`;
const IN_LIBRARY = `search-result-${MASTER}-in-library`;

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    key: `show:${MASTER}`,
    type: "show",
    traktId: MASTER,
    title: "The Harbor Master",
    year: 2011,
    posters: [],
    tmdbId: null,
    ids: { trakt: MASTER },
    ...overrides,
  };
}

const TRACKED = hit({ key: `show:${HARBOR}`, traktId: HARBOR, title: "Harbor Lights", year: 2021 });
const MOVIE = hit({
  key: `movie:${SOUND}`,
  type: "movie",
  traktId: SOUND,
  title: "Harbor Sound",
  year: 2015,
});

/** The Settings switches, which decide both the placeholder and which grids and
 * which hits this reader is shown. */
function media(shows: boolean, movies: boolean): PreferenceStorage {
  const preferences = memoryPreferences();
  preferences.setItem("cue.shows-enabled", shows ? "1" : "0");
  preferences.setItem("cue.movies-enabled", movies ? "1" : "0");
  return preferences;
}

interface Options {
  readonly search?: (query: string) => Promise<readonly SearchHit[]>;
  readonly browse?: Partial<Parameters<typeof fakeRuntime>[0]["browse"]>;
  readonly preferences?: PreferenceStorage;
  readonly offline?: boolean;
}

async function paint({ search, browse, preferences, offline = false }: Options = {}) {
  const view = await render(
    <Harness
      runtime={fakeRuntime({ search, browse })}
      haptics={haptics}
      preferences={preferences}
      network={offline ? OFFLINE : undefined}
    >
      <Search />
    </Harness>,
  );
  await waitFor(() => expect(screen.queryByTestId("browse-skeleton")).toBeNull());
  await act(async () => {});
  return view;
}

/** One settled query, typed the way a finger types it: every keystroke lands
 * before the debounce does. */
async function type(...keystrokes: readonly string[]): Promise<void> {
  const field = screen.getByTestId(SEARCH_FIELD);
  for (const keystroke of keystrokes) await fireEvent.changeText(field, keystroke);
  await act(async () => {});
}

/** A query typed, left standing long enough for Search to remember it, then
 * cleared back to the idle screen its recent terms live on. */
async function rest(query: string): Promise<void> {
  await type(query);
  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_MS + 200));
  });
  await type("");
}

const gridTitles = (): (string | undefined)[] =>
  screen
    .getAllByTestId(/^(show|movie)-card-/)
    .map((tile) => String(tile.props["accessibilityLabel"]));

afterEach(() => {
  // A case that fails mid-flash would otherwise leave fake timers installed and
  // every case after it stuck on a skeleton.
  jest.useRealTimers();
  jest.clearAllMocks();
});

it("opens on a browse grid for each enabled medium", async () => {
  await paint({ browse: { trending: [TRACKED], popularMovies: [MOVIE] } });

  expect(screen.getByTestId("search-browse")).toBeOnTheScreen();
  expect(screen.getByText("Trending shows")).toBeOnTheScreen();
  expect(screen.getByText("Popular movies")).toBeOnTheScreen();
  expect(gridTitles()).toEqual(["Harbor Lights, Show, 2021", "Harbor Sound, Movie, 2015"]);
});

it("drops a browse grid with nothing in it", async () => {
  await paint({ browse: { trending: [], popularMovies: [MOVIE] } });

  expect(screen.getAllByTestId("browse-grid")).toHaveLength(1);
  expect(screen.queryByText("Trending shows")).toBeNull();
  expect(screen.getByText("Popular movies")).toBeOnTheScreen();
});

it("drops the grid of a medium the reader has turned off", async () => {
  await paint({
    browse: { trending: [TRACKED], popularMovies: [MOVIE] },
    preferences: media(true, false),
  });

  expect(screen.getAllByTestId("browse-grid")).toHaveLength(1);
  expect(screen.queryByText("Popular movies")).toBeNull();
});

it("searches once for a settled query", async () => {
  const search = jest.fn(() => Promise.resolve([TRACKED]));
  await paint({ search });

  await type("h", "ha", "harbor");
  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());

  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith("harbor");
});

it("forgets recent terms when the screen is left", async () => {
  const view = await paint({ search: () => Promise.resolve([TRACKED]) });
  await rest("harbor");
  expect(screen.getByTestId("search-recent-row")).toBeOnTheScreen();
  await view.unmount();

  await paint({ search: () => Promise.resolve([TRACKED]) });

  expect(screen.queryByTestId("search-recent-row")).toBeNull();
});

it("re-runs a rested query when its recent term is tapped", async () => {
  await paint({ search: () => Promise.resolve([TRACKED]) });
  await rest("harbor");
  expect(labelOf(screen.getByTestId("search-recent-row"))).toBe("Search harbor again");

  await fireEvent.press(screen.getByTestId("search-recent-row"));

  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());
});

it("flashes Added for 600 ms and then settles into In library", async () => {
  await paint({ search: () => Promise.resolve([hit()]) });
  await type("harbor");
  await waitFor(() =>
    expect(screen.getByTestId(`search-result-${MASTER}-watchlist`)).toBeOnTheScreen(),
  );

  jest.useFakeTimers();
  await fireEvent.press(screen.getByTestId(`search-result-${MASTER}-watchlist`));
  expect(screen.getByTestId(ADDED)).toBeOnTheScreen();

  await act(async () => void jest.advanceTimersByTime(FLASH_MS - 1));
  expect(screen.queryByTestId(ADDED)).not.toBeNull();

  await act(async () => void jest.advanceTimersByTime(1));
  expect(screen.queryByTestId(ADDED)).toBeNull();
  expect(screen.getByTestId(IN_LIBRARY)).toBeOnTheScreen();
});

it("offers no add for a title already in the library", async () => {
  await paint({ search: () => Promise.resolve([TRACKED]) });
  await type("harbor");
  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());

  await fireEvent.press(screen.getByTestId(`search-result-${HARBOR}-watchlist`));
  await act(async () => {});

  expect(screen.queryByTestId(`search-result-${HARBOR}-watchlist`)).toBeNull();
});

it("names results a media setting is hiding", async () => {
  await paint({
    search: () => Promise.resolve([MOVIE, MOVIE]),
    preferences: media(true, false),
  });

  await type("harbor");

  await waitFor(() => expect(screen.getByTestId("search-no-results")).toBeOnTheScreen());
  expect(screen.getByText('Nothing for "harbor".')).toBeOnTheScreen();
  expect(
    screen.getByText("2 results are hidden in Movies. Turn Movies on in Settings to see them."),
  ).toBeOnTheScreen();
});

it("blames the spelling when nothing matched at all", async () => {
  await paint({ search: () => Promise.resolve([]) });

  await type("zeppelin");

  await waitFor(() => expect(screen.getByTestId("search-no-results")).toBeOnTheScreen());
  expect(screen.getByText("Check spelling or try the year.")).toBeOnTheScreen();
});

it("offers Retry when the search fails", async () => {
  await paint({
    search: () => Promise.reject(new TraktReadError({ kind: "network" }, "search results")),
  });

  await type("harbor");

  await waitFor(() => expect(screen.getByTestId("search-error")).toBeOnTheScreen());
  expect(screen.getByText("Search failed")).toBeOnTheScreen();
  expect(screen.getByTestId("search-error-retry")).toBeOnTheScreen();
});

it("says a query needs a connection, and browse does not", async () => {
  await paint({ browse: { trending: [TRACKED] }, offline: true });
  expect(screen.getByTestId("search-browse")).toBeOnTheScreen();

  await type("harbor");

  await waitFor(() => expect(screen.getByTestId("search-offline")).toBeOnTheScreen());
  expect(screen.getByText("Search needs a connection.")).toBeOnTheScreen();
});

const labelOf = (element: { props: Record<string, unknown> }): string =>
  String(element.props["accessibilityLabel"]);
