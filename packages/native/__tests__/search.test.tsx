import { TraktReadError } from "@cue/core/data/trakt/client";
import type { SearchHit } from "@cue/core/data/trakt/search";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SEARCH_FIELD } from "./support/native-ui";
import { fakeRuntime, Harness, memoryPreferences, OFFLINE, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const Search = (
  require("../app/(tabs)/(search)/search") as typeof import("../app/(tabs)/(search)/search")
).default;

/** The confirmation's own duration, spelled here rather than imported, so the
 * case fails if the screen changes how long the flash holds. */
const FLASH_MS = 600;

const haptics = spyHaptics();
const HARBOR = 8801;
const MASTER = 8901;
const SOUND = 5601;

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

it("keeps five recent terms, newest first", async () => {
  const search = jest.fn(() => Promise.resolve([TRACKED]));
  await paint({ search });

  const terms = ["one", "two", "three", "four", "five", "six"];
  for (const [index, term] of terms.entries()) {
    await type(term);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(index + 1));
    await act(async () => {});
  }
  await type("");

  expect(screen.getAllByTestId("search-recent-row").map((row) => labelOf(row))).toEqual([
    "Search six again",
    "Search five again",
    "Search four again",
    "Search three again",
    "Search two again",
  ]);
});

it("forgets recent terms when the screen is left", async () => {
  const view = await paint({ search: () => Promise.resolve([TRACKED]) });
  await type("harbor");
  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());
  await view.unmount();

  await paint({ search: () => Promise.resolve([TRACKED]) });

  expect(screen.queryByTestId("search-recent-row")).toBeNull();
});

it("runs a recent term again when it is tapped", async () => {
  const search = jest.fn(() => Promise.resolve([TRACKED]));
  await paint({ search });
  await type("harbor");
  await waitFor(() => expect(screen.getByTestId(`search-result-${HARBOR}`)).toBeOnTheScreen());
  await type("");

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
  expect(screen.getByTestId("search-added")).toBeOnTheScreen();

  await act(async () => void jest.advanceTimersByTime(FLASH_MS - 1));
  expect(screen.queryByTestId("search-added")).not.toBeNull();

  await act(async () => void jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("search-added")).toBeNull();
  expect(screen.getByTestId("search-in-library")).toBeOnTheScreen();
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
