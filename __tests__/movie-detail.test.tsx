import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { SearchHit } from "@/core/domain/discover";
import { TraktReadError } from "@/core/domain/read-failure";
import { buildMarkMovieOp, buildUndoAddOp } from "@/core/domain/write-queue/ops";
import { persistMediaVisibility } from "@/core/prefs/media-visibility";
import { movieHeaderQuery } from "@/core/queries/movies";
import { MovieDetail } from "../src/screens/MovieDetail";
import { TEST_IDS } from "../src/ui/test-ids";
import { memoryPreferenceStorage } from "../test/core/support/stores";
import { movieEntry, movieHeader, movieRuntime, pendingMovieRuntime } from "./support/movie-detail";
import { chooseHeaderAction, router } from "./support/native-ui";
import { Harness, resetSharedStores, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));

beforeEach(() => {
  resetSharedStores();
  jest.clearAllMocks();
});

async function mount(runtime = movieRuntime(), preferences = memoryPreferenceStorage()) {
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
  await chooseHeaderAction(
    movieHeader.title,
    inWatchlist ? "Remove from Watchlist" : "Add to Watchlist",
  );
  expect(
    await screen.findByText(inWatchlist ? "Add to Watchlist" : "Remove from Watchlist"),
  ).toBeOnTheScreen();
  expect(screen.queryByText("In Watchlist") !== null).toBe(!inWatchlist);
  expect(runtime.submit.mock.calls[0]?.[0].request.path).toBe(
    inWatchlist ? "/sync/watchlist/remove" : "/sync/watchlist",
  );
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(
    await screen.findByText(inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"),
  ).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.movieMark)).toBeChecked();
  expect(screen.queryByText("In Watchlist") !== null).toBe(inWatchlist);
});

it("opens Trakt in the browser", async () => {
  await mount();
  await chooseHeaderAction(movieHeader.title, "Open on Trakt");
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
  const preferences = memoryPreferenceStorage();
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

it("queues the Undo of a mark that may already be on Trakt, to take back only that mark's play", async () => {
  jest.useFakeTimers();
  try {
    const { runtime, pending } = pendingMovieRuntime(true);
    await mount(runtime);
    await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(runtime.submit.mock.calls.map(([op]) => op.undoes)).toEqual([pending.id]);
    expect(screen.queryByText("Couldn't update this movie. Please try again.")).toBeNull();
    expect(screen.getByTestId(TEST_IDS.movieMark)).not.toBeChecked();
  } finally {
    jest.useRealTimers();
  }
});

it("takes back the latest queued mark, not an earlier one whose Undo is already queued", async () => {
  const { runtime, pending } = pendingMovieRuntime(true);
  const again = buildMarkMovieOp({
    opId: "again",
    ids: movieHeader.ids,
    watchedAt: "2026-08-09T12:00:00Z",
  });
  runtime.pendingOps = () => [pending, buildUndoAddOp("undo", pending), again];
  runtime.writeState.mockImplementation((opId) => (opId === pending.id ? "sent" : "unsent"));
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await waitFor(() => expect(runtime.submit).toHaveBeenCalled());
  expect(runtime.submit.mock.calls.map(([op]) => [op.itemKey, op.toState, op.undoes])).toEqual([
    [again.itemKey, "absent", undefined],
  ]);
});

it("undoes a landed first watch to the unwatched face by taking back that mark", async () => {
  const runtime = await mount(movieRuntime({ watched: false, watchedAt: null }));
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await screen.findByText("The Lantern Keeper marked watched");
  runtime.writeState.mockReturnValue("done");
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(await screen.findByText("Not watched yet")).toBeOnTheScreen();
  expect(runtime.submit.mock.calls[1]?.[0].undoes).toBe(runtime.submit.mock.calls[0]?.[0].id);
  expect(runtime.loadMoviePlays).not.toHaveBeenCalled();
});

it("shows the movie error when membership cannot load", async () => {
  const runtime = movieRuntime();
  runtime.loadMovieLibrary.mockRejectedValue(new Error("offline"));
  await mount(runtime);
  expect(await screen.findByText("Couldn't load this movie")).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.movieMark)).toBeNull();
});

it.each([
  [{ kind: "server", status: 503 } as const, "Trakt is having trouble. Try again in a moment."],
  [
    { kind: "rate-limited", retryAfterMs: null } as const,
    "Trakt is limiting requests. Cue will try again shortly.",
  ],
  [{ kind: "network" } as const, "Check your connection and try again."],
])("says why the movie could not load after a %j failure", async (failure, body) => {
  const runtime = movieRuntime();
  runtime.loadMovieLibrary.mockRejectedValue(new TraktReadError(failure, "movie library"));
  await mount(runtime);
  expect(await screen.findByText("Couldn't load this movie")).toBeOnTheScreen();
  expect(screen.getByText(body)).toBeOnTheScreen();
});

const replaced = { added: 0, updated: 1, deleted: 0, existing: 0, notFound: 0 };

it("offers no Undo when Trakt replaced the movie's play, and says what happened", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  runtime.submit.mockResolvedValue("done");
  runtime.writeReceipt = () => replaced;
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  expect(
    await screen.findByText(
      "The Lantern Keeper was already watched. Trakt changed its watch date to now.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.snackbarUndo)).toBeNull();
});

it("undoes nothing when the mark Trakt kept for later was refused", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await screen.findByText("The Lantern Keeper marked watched");
  runtime.writeState.mockReturnValue("failed");
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  await waitFor(() => expect(runtime.writeState).toHaveBeenCalled());
  expect(runtime.submit).toHaveBeenCalledTimes(1);
  expect(runtime.loadMoviePlays).not.toHaveBeenCalled();
  expect(screen.queryByText("Couldn't update this movie. Please try again.")).toBeNull();
});

it("ignores a second change to the movie while the first is still being saved", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  runtime.submit.mockReturnValue(new Promise(() => {}));
  await mount(runtime);
  await chooseHeaderAction(movieHeader.title, "Add to Watchlist");
  await chooseHeaderAction(movieHeader.title, "Remove from Watchlist");
  expect(runtime.submit).toHaveBeenCalledTimes(1);
});

it("undoes a mark while a watchlist change made after it is still being saved", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await screen.findByText("The Lantern Keeper marked watched");
  const mark = runtime.submit.mock.calls[0]?.[0];
  runtime.submit.mockReturnValueOnce(new Promise(() => {}));
  await chooseHeaderAction(movieHeader.title, "Add to Watchlist");
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  await waitFor(() => expect(runtime.submit).toHaveBeenCalledTimes(3));
  expect(runtime.submit.mock.calls[2]?.[0]).toMatchObject({
    itemKey: mark?.itemKey,
    toState: "absent",
  });
  expect(screen.getByTestId(TEST_IDS.movieMark)).not.toBeChecked();
});

it("removes nothing when an Undo finds that the mark replaced the movie's play", async () => {
  const runtime = movieRuntime({ watched: false, watchedAt: null });
  await mount(runtime);
  await fireEvent.press(await screen.findByTestId(TEST_IDS.movieMark));
  await screen.findByText("The Lantern Keeper marked watched");
  runtime.writeState.mockReturnValue("done");
  runtime.writeReceipt = () => replaced;
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(
    await screen.findByText(
      "The Lantern Keeper was already watched. Trakt changed its watch date to now. Undo can't restore the earlier date.",
    ),
  ).toBeOnTheScreen();
  expect(runtime.submit).toHaveBeenCalledTimes(1);
  expect(runtime.loadMoviePlays).not.toHaveBeenCalled();
});

it("clears Search's added state when the movie leaves the watchlist from its detail page", async () => {
  const Search = (
    require("../app/(tabs)/(search)/search") as typeof import("../app/(tabs)/(search)/search")
  ).default;
  const listed = new Set<number>();
  const runtime = movieRuntime();
  runtime.loadMovieLibrary.mockImplementation(async () => ({
    entries: [...listed].map(() => ({ ...movieEntry, watched: false, inWatchlist: true })),
  }));
  runtime.loadMovieWatchlist.mockImplementation(async () =>
    [...listed].map((movieId) => ({ ...movieEntry, movieId, watched: false, inWatchlist: true })),
  );
  runtime.submit.mockImplementation(async (op) => {
    if (op.request.path === "/sync/watchlist") listed.add(movieHeader.movieId);
    else listed.delete(movieHeader.movieId);
    return "done";
  });
  const hit: SearchHit = {
    key: `movie:${movieHeader.movieId}`,
    type: "movie",
    traktId: movieHeader.movieId,
    title: movieHeader.title,
    year: movieHeader.year,
    posters: [],
    tmdbId: null,
    ids: movieHeader.ids,
  };
  await render(
    <Harness runtime={{ ...runtime, search: async () => [hit] }} haptics={spyHaptics()}>
      <Search />
      <MovieDetail movieId={movieHeader.movieId} />
    </Harness>,
  );
  await fireEvent.changeText(screen.getByTestId(TEST_IDS.searchField), "lantern");
  const add = TEST_IDS.searchResult(movieHeader.movieId);
  await fireEvent.press(await screen.findByTestId(`${add}-watchlist`));
  expect(await screen.findByTestId(`${add}-in-library`)).toBeOnTheScreen();

  await chooseHeaderAction(movieHeader.title, "Remove from Watchlist");

  expect(await screen.findByTestId(`${add}-watchlist`)).toBeOnTheScreen();
});
