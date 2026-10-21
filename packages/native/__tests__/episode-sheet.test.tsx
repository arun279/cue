import "./support/detail-mocks";
import { persistMediaVisibility } from "@cue/core/prefs/media-visibility";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import EpisodeRoute from "../app/show/[showId]/episode/[season]/[episode]";
import { EpisodeBody, EpisodeSheet } from "../src/screens/EpisodeSheet";
import { EpisodePager } from "../src/screens/episode-sheet/EpisodePager";
import { EpisodeStill } from "../src/screens/episode-sheet/EpisodeStill";
import { TEST_IDS } from "../src/ui/test-ids";
import { DetailHarness, detail, detailRuntime } from "./support/detail";
import { router } from "./support/native-ui";
import { memoryPreferences, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => ({
  ...require("./support/native-ui").expoRouterModule(),
  useLocalSearchParams: () => ({ showId: "8803", season: "2", episode: "4" }),
}));

beforeEach(() => {
  resetSharedStores();
  jest.clearAllMocks();
});

it("shows an unaired countdown with no mark row, still or past-tense air date", async () => {
  await render(
    <EpisodeBody
      detail={{ ...detail, aired: false, firstAired: "2026-11-16T12:00:00Z" }}
      guarded
      plays={0}
      onMark={jest.fn()}
    />,
  );
  expect(screen.getByText("S2 E3 · 58 min")).toBeOnTheScreen();
  expect(screen.getByText(/^Airs Mon Nov 16/)).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.episodeMarkRow)).toBeNull();
  expect(screen.queryByTestId(TEST_IDS.episodeStillBlur)).toBeNull();
  expect(screen.queryByRole("switch")).toBeNull();
});

it("closes the missing-still slot while retaining the episode and its mark", async () => {
  await render(
    <EpisodeBody detail={{ ...detail, stills: [] }} guarded plays={0} onMark={jest.fn()} />,
  );
  expect(screen.queryByTestId(TEST_IDS.episodeStillReveal)).toBeNull();
  expect(screen.getByText("Salt Air")).toBeOnTheScreen();
  expect(screen.getByText("Not watched yet")).toBeOnTheScreen();
});

it("reveals only the selected episode for the session and drops a broken still", async () => {
  const view = await render(<EpisodeStill episodeId={4001} stills={detail.stills} guarded />);
  expect(screen.getByTestId(TEST_IDS.episodeStillBlur).props["blurRadius"]).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole("button", { name: "Reveal episode still" }));
  expect(screen.queryByTestId(TEST_IDS.episodeStillBlur)).toBeNull();
  await view.rerender(<EpisodeStill key={4002} episodeId={4002} stills={detail.stills} guarded />);
  expect(screen.getByTestId(TEST_IDS.episodeStillBlur)).toBeOnTheScreen();
  await fireEvent(screen.getByTestId(TEST_IDS.episodeStillBlur), "error");
  expect(screen.queryByTestId(TEST_IDS.episodeStillReveal)).toBeNull();
  await view.rerender(<EpisodeStill key={4001} episodeId={4001} stills={detail.stills} guarded />);
  expect(screen.queryByTestId(TEST_IDS.episodeStillReveal)).toBeNull();
});

it("does not guard a watched episode or a still with guarding disabled", async () => {
  await render(
    <EpisodeBody
      detail={{ ...detail, watched: true }}
      guarded={false}
      plays={2}
      onMark={jest.fn()}
    />,
  );
  expect(screen.queryByTestId(TEST_IDS.episodeStillReveal)).toBeNull();
  expect(screen.getByText("Watched twice")).toBeOnTheScreen();
  expect(screen.getByText("2 plays")).toBeOnTheScreen();
});

it("marks from the sheet and exposes the same reversible snackbar", async () => {
  let watched = false;
  const runtime = {
    ...detailRuntime,
    loadEpisode: jest.fn(async () => ({ ...detail, watched })),
    submit: jest.fn<
      ReturnType<typeof detailRuntime.submit>,
      Parameters<typeof detailRuntime.submit>
    >(async (op) => {
      watched = op.toState === "present";
      return "done";
    }),
  };
  await render(
    <DetailHarness runtime={runtime}>
      <EpisodeSheet showId={8803} season={2} episode={3} />
    </DetailHarness>,
  );
  expect(screen.getByTestId(TEST_IDS.episodeMarkControl)).toHaveAccessibleName(
    "Mark S2 E3 watched",
  );
  await fireEvent.press(within(screen.getByTestId(TEST_IDS.episodeMarkRow)).getByRole("switch"));
  expect(screen.getByTestId(TEST_IDS.snackbarUndo)).toBeOnTheScreen();
  expect(within(screen.getByTestId(TEST_IDS.episodeMarkRow)).getByRole("switch")).toBeChecked();
  await fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  await waitFor(() =>
    expect(
      within(screen.getByTestId(TEST_IDS.episodeMarkRow)).getByRole("switch"),
    ).not.toBeChecked(),
  );
});

it("replaces the episode route and names an exhausted direction", async () => {
  await render(<EpisodePager showId={8803} prev={null} next={{ season: 2, number: 4 }} />);
  expect(screen.getByRole("button", { name: "No earlier episode" })).toBeDisabled();
  await fireEvent.press(screen.getByTestId(TEST_IDS.episodePagerNext));
  expect(router.replace).toHaveBeenCalledWith("/show/8803/episode/2/4");
  expect(router.push).not.toHaveBeenCalled();
});

it("closes from its close button while the episode loads", async () => {
  const runtime = { ...detailRuntime, loadEpisode: jest.fn(() => new Promise<never>(() => {})) };
  await render(
    <DetailHarness runtime={runtime}>
      <EpisodeSheet showId={8803} season={2} episode={4} />
    </DetailHarness>,
  );

  expect(screen.getByTestId(TEST_IDS.episodeSkeleton)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

it("says TV shows are off inside the sheet, reads nothing and still closes", async () => {
  const preferences = memoryPreferences();
  persistMediaVisibility(preferences, { showsEnabled: false, moviesEnabled: true });
  const runtime = { ...detailRuntime, loadEpisode: jest.fn() };
  await render(
    <DetailHarness runtime={runtime} preferences={preferences}>
      <EpisodeRoute />
    </DetailHarness>,
  );

  expect(screen.getByText("TV shows are turned off.")).toBeOnTheScreen();
  expect(runtime.loadEpisode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

it("offers one menu for a watched episode beside its close button", async () => {
  const watched = { ...detail, number: 4, watched: true, watchedAt: "2026-10-01T20:00:00Z" };
  const runtime = { ...detailRuntime, loadEpisode: jest.fn(async () => watched) };
  await render(
    <DetailHarness runtime={runtime}>
      <EpisodeSheet showId={8803} season={2} episode={4} />
    </DetailHarness>,
  );

  expect(await screen.findAllByText("Add another play")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(router.back).toHaveBeenCalledTimes(1);
});
