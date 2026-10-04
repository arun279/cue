import { persistMediaVisibility } from "@cue/core/prefs/media-visibility";
import { movieHeaderQuery } from "@cue/core/queries/movies";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { MovieDetail } from "../src/screens/MovieDetail";
import { TEST_IDS } from "../src/ui/test-ids";
import { movieEntry, movieHeader, movieRuntime, pendingMovieRuntime } from "./support/movie-detail";
import { router } from "./support/native-ui";
import { Harness, memoryPreferences, resetSharedStores, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => {
  const module = require("./support/native-ui").expoRouterModule();
  module.Stack.Screen = ({ options }: { options: { headerRight?: () => unknown } }) =>
    options.headerRight?.() ?? null;
  return module;
});
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

beforeEach(() => {
  resetSharedStores();
  jest.clearAllMocks();
});

async function mount(runtime = movieRuntime(), preferences = memoryPreferences()) {
  await render(
    <Harness runtime={runtime} haptics={spyHaptics()} preferences={preferences}>
      <MovieDetail movieId={5501} />
    </Harness>,
  );
  return runtime;
}

it("renders the marked face and removes only the resolved play", async () => {
  const runtime = await mount();
  expect(await screen.findByText("Watched Aug 8, 2026")).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
  await fireEvent.press(screen.getByTestId(TEST_IDS.movieMark));
  expect(await screen.findByText("Not watched yet")).toBeOnTheScreen();
  expect(runtime.submit.mock.calls[0]?.[0].request.body).toEqual({ ids: [91] });
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  await waitFor(() => expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked());
  expect(runtime.submit.mock.calls[1]?.[0].request.body).toEqual({
    movies: [{ ids: movieHeader.ids, watched_at: movieEntry.watchedAt }],
  });
});

it("marks an unwatched movie and undoes only that newly landed play", async () => {
  const runtime = await mount(movieRuntime({ watched: false, watchedAt: null }));
  expect(await screen.findByText("Not watched yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId(TEST_IDS.movieMark));
  expect(await screen.findByText("The Lantern Keeper marked watched")).toBeOnTheScreen();
  const watchedAt = runtime.submit.mock.calls[0]?.[0].watchedAt ?? "";
  runtime.loadMoviePlays.mockResolvedValue([
    { historyId: 92, watchedAt },
    { historyId: 91, watchedAt: "2020-01-01T12:00:00Z" },
  ]);
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(await screen.findByText("Watched Jan 1, 2020")).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
  expect(runtime.submit.mock.calls[1]?.[0].request.body).toEqual({ ids: [92] });
});

it("refuses a rewatched film and opens movie history", async () => {
  const runtime = movieRuntime();
  runtime.loadMoviePlays.mockResolvedValue([
    { historyId: 91, watchedAt: "2026-08-08T12:00:00Z" },
    { historyId: 92, watchedAt: "2026-08-09T12:00:00Z" },
  ]);
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  expect(
    await screen.findByText(
      "This movie has 2 plays. Remove a specific play in your watch history.",
    ),
  ).toBeOnTheScreen();
  expect(runtime.submit).not.toHaveBeenCalled();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
  await fireEvent.press(screen.getByText("Open history"));
  expect(router.push).toHaveBeenCalledWith("/history?type=movies");
});

it.each([false, true])("toggles watchlist membership from %s with Undo", async (inWatchlist) => {
  const runtime = await mount(movieRuntime({ inWatchlist }));
  await fireEvent.press(
    await screen.findByText(inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"),
  );
  expect(
    await screen.findByText(inWatchlist ? "Add to Watchlist" : "Remove from Watchlist"),
  ).toBeOnTheScreen();
  expect(runtime.submit.mock.calls[0]?.[0].request.path).toBe(
    inWatchlist ? "/sync/watchlist/remove" : "/sync/watchlist",
  );
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(
    await screen.findByText(inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"),
  ).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
});

it("opens Trakt in the browser", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Open on Trakt"));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
    "https://trakt.tv/movies/the-lantern-keeper",
  );
});

it("caps related movies at six and opens the selected film", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieRelated.mockResolvedValue(
    Array.from({ length: 8 }, (_, index) => ({
      key: String(index),
      type: "movie",
      traktId: index + 6000,
      title: `Related ${index}`,
      year: 2024,
      posters: [],
      tmdbId: null,
      ids: { trakt: index + 6000 },
    })),
  );
  await mount(runtime);
  await screen.findByText("More like this");
  expect(screen.getAllByRole("button", { name: /^Related / })).toHaveLength(6);
  expect(screen.queryByText("Related 6")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Related 5" }));
  expect(router.push).toHaveBeenCalledWith("/movie/6005");
});

it("turns movies off without issuing any movie reads", async () => {
  const preferences = memoryPreferences();
  persistMediaVisibility(preferences, { showsEnabled: true, moviesEnabled: false });
  const runtime = await mount(movieRuntime(), preferences);
  expect(screen.getByText("Movies are turned off")).toBeOnTheScreen();
  expect(runtime.loadMovieHeader).not.toHaveBeenCalled();
  expect(runtime.loadMovieLibrary).not.toHaveBeenCalled();
  expect(runtime.loadMovieRelated).not.toHaveBeenCalled();
  expect(runtime.loadMoviePlays).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Open Settings"));
  expect(router.push).toHaveBeenCalledWith("/settings");
});

it("shows a loading skeleton", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieHeader.mockReturnValue(new Promise(() => {}));
  await mount(runtime);
  expect(screen.getByTestId(TEST_IDS.movieDetailSkeleton)).toBeOnTheScreen();
});

it("retries a failed header read", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieHeader.mockRejectedValueOnce(new Error("offline"));
  await mount(runtime);
  await fireEvent.press(await screen.findByText("Retry"));
  expect(await screen.findByText(movieHeader.title)).toBeOnTheScreen();
});

it("keeps cached content when its refresh fails", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieHeader.mockRejectedValue(new Error("offline"));
  await render(
    <Harness
      runtime={runtime}
      haptics={spyHaptics()}
      seed={(client) =>
        client.setQueryData(movieHeaderQuery(runtime, 5501).queryKey, movieHeader, { updatedAt: 1 })
      }
    >
      <MovieDetail movieId={5501} />
    </Harness>,
  );
  expect(await screen.findByText(movieHeader.title)).toBeOnTheScreen();
  expect(screen.queryByText("Couldn't load this movie")).toBeNull();
});

it("rolls back a rejected mark", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  runtime.submit.mockResolvedValue("failed");
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  expect(
    await screen.findByText("Couldn't update this movie. Please try again."),
  ).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).not.toBeChecked();
});

it("keeps the watched face when resolving plays fails", async () => {
  const runtime = movieRuntime();
  runtime.loadMoviePlays.mockRejectedValue(new Error("offline"));
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  expect(
    await screen.findByText("Couldn't update this movie. Please try again."),
  ).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
  expect(runtime.submit).not.toHaveBeenCalled();
});

it("cancels a deferred mark after remount without reading live plays", async () => {
  const { runtime, pending } = pendingMovieRuntime();
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await waitFor(() => expect(screen.getByTestId(TEST_IDS.movieMark)).not.toBeChecked());
  expect(runtime.loadMoviePlays).not.toHaveBeenCalled();
  expect(runtime.submit.mock.calls[0]?.[0].itemKey).toBe(pending.itemKey);
  expect(runtime.submit.mock.calls[0]?.[0].toState).toBe("absent");
});

it("does not send an item removal while a mark is in flight", async () => {
  const { runtime } = pendingMovieRuntime(true);
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  expect(
    await screen.findByText("Couldn't update this movie. Please try again."),
  ).toBeOnTheScreen();
  expect(runtime.submit).not.toHaveBeenCalled();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
});

it("undoes a landed first watch to the unwatched face", async () => {
  const runtime = await mount(movieRuntime({ watched: false, watchedAt: null }));
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await screen.findByText("The Lantern Keeper marked watched");
  runtime.loadMoviePlays.mockResolvedValue([
    { historyId: 92, watchedAt: runtime.submit.mock.calls[0]?.[0].watchedAt ?? "" },
  ]);
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(await screen.findByText("Not watched yet")).toBeOnTheScreen();
  expect(runtime.submit.mock.calls[1]?.[0].request.body).toEqual({ ids: [92] });
});

it("shows the movie error when membership cannot load", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieLibrary.mockRejectedValue(new Error("offline"));
  await mount(runtime);
  expect(await screen.findByText("Couldn't load this movie")).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.movieMark)).toBeNull();
});
