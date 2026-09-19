import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import "./support/screen-mocks";
import Profile from "../src/screens/Profile";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture, STATS } from "./support/account";
import { router } from "./support/native-ui";

it("shows identity and matching enabled-media totals, with both navigation destinations", async () => {
  const fixture = accountFixture();
  await fixture.paint(<Profile />);
  expect(await screen.findByText("Jo Taylor")).toBeVisible();
  expect(await screen.findByLabelText("81 episodes watched")).toBeVisible();
  expect(screen.getByText("8 hr 3 min")).toBeVisible();
  await act(() => fixture.prefs.getState().setMoviesEnabled(false));
  expect(screen.queryByTestId(TEST_IDS.profileStatMovies)).toBeNull();
  expect(screen.getByText("6 hr 18 min")).toBeVisible();
  await act(() => {
    fixture.prefs.getState().setMoviesEnabled(true);
    fixture.prefs.getState().setShowsEnabled(false);
  });
  expect(screen.queryByTestId(TEST_IDS.profileStatShows)).toBeNull();
  expect(screen.queryByTestId(TEST_IDS.profileEpisodeCount)).toBeNull();
  expect(screen.getByText("45 min")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "History" }));
  expect(router.push).toHaveBeenLastCalledWith("/history");
  await userEvent.press(screen.getByRole("button", { name: "Settings" }));
  expect(router.push).toHaveBeenLastCalledWith("/settings");
  await fireEvent(screen.getByTestId(TEST_IDS.profileAvatar), "error");
  expect(screen.queryByTestId(TEST_IDS.profileAvatar)).toBeNull();
  expect(screen.getByText("Jo Taylor")).toBeVisible();
});

it("keeps identity and navigation usable while stats load", async () => {
  await accountFixture({
    loadStats: () => new Promise(() => {}),
    loadUserProfile: () => new Promise(() => {}),
  }).paint(<Profile />);
  expect(screen.getByLabelText("Loading stats")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
});

it("recovers stats independently of a failed profile request", async () => {
  const loadStats = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(STATS);
  await accountFixture({
    loadStats,
    loadUserProfile: () => Promise.reject(new Error("offline")),
  }).paint(<Profile />);
  expect(await screen.findByText("Couldn't load your stats")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("7 shows watched")).toBeVisible();
});

it("offers discovery when the enabled media has no watch history", async () => {
  const fixture = accountFixture({
    loadStats: () =>
      Promise.resolve({ ...STATS, episodes: { watched: 0, minutes: 0 }, shows: { watched: 0 } }),
  });
  fixture.prefs.getState().setMoviesEnabled(false);
  await fixture.paint(<Profile />);
  expect(await screen.findByText("Nothing tallied yet.")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Find something to watch" }));
  expect(router.dismissTo).toHaveBeenCalledWith("/search");
});
