import { seasonConfirmation } from "@cue/core/domain/show-detail";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import { ShowDetail } from "../src/screens/ShowDetail";
import { ContinueBar } from "../src/screens/show-detail/ContinueBar";
import { confirm } from "../src/ui/confirm";
import { TEST_IDS } from "../src/ui/test-ids";
import { DetailHarness, detailRuntime } from "./support/detail";
import { router } from "./support/native-ui";
import { entry, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const mark = { mark: jest.fn(), reverse: jest.fn(), reArm: jest.fn(), justMarkedAt: () => null };
beforeEach(resetSharedStores);

it.each([
  ["next", entry(), "Next"],
  [
    "returning",
    entry({
      completed: 21,
      nextEpisode: {
        season: 3,
        number: 1,
        title: null,
        still: null,
        ids: { trakt: 1 },
        firstAired: new Date(Date.now() + 87 * 86400000).toISOString(),
      },
    }),
    "All caught up",
  ],
  [
    "finished",
    entry({ completed: 21, status: "ended", nextEpisode: null }),
    "Ended. You finished it.",
  ],
  ["caught-up", entry({ completed: 21, nextEpisode: null }), "All caught up"],
] as const)("renders the %s continue state", async (kind, show, headline) => {
  await render(<ContinueBar entry={show} mark={mark} />);
  expect(screen.getByText(headline)).toBeOnTheScreen();
  expect(screen.queryAllByRole("switch")).toHaveLength(kind === "next" ? 1 : 0);
  if (kind === "returning") expect(screen.getByText("S3 returns in 87 days")).toBeOnTheScreen();
});

it("offers Start watching before the first mark", async () => {
  await render(<ContinueBar entry={entry({ completed: 0 })} mark={mark} />);
  expect(screen.getByText("Start watching")).toBeOnTheScreen();
  expect(screen.getByText("21 episodes")).toBeOnTheScreen();
});

it("keeps the seasons accordion in descending order with Specials last", async () => {
  await render(
    <DetailHarness>
      <ShowDetail showId={8803} />
    </DetailHarness>,
  );
  expect(screen.getAllByTestId(/^season-row-/).map((row) => row.props["testID"])).toEqual([
    "season-row-2",
    "season-row-1",
    "season-row-0",
  ]);
  expect(screen.getByTestId(TEST_IDS.episodeChecked(8803, 2, 1))).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.episodeChecked(8803, 0, 1))).toBeNull();
  await fireEvent.press(screen.getByTestId(TEST_IDS.seasonTrigger(2)));
  expect(screen.queryByTestId(TEST_IDS.episodeChecked(8803, 2, 1))).toBeNull();
});

it("caps related shows at six and opens the selected show", async () => {
  const runtime = {
    ...detailRuntime,
    loadShowRelated: jest.fn(async () =>
      Array.from({ length: 7 }, (_, index) => ({
        key: String(index),
        type: "show" as const,
        traktId: index + 9000,
        title: `Related ${index}`,
        year: 2024,
        posters: [],
        tmdbId: null,
        ids: { trakt: index + 9000 },
      })),
    ),
  };
  await render(
    <DetailHarness runtime={runtime}>
      <ShowDetail showId={8803} />
    </DetailHarness>,
  );
  await screen.findByText("More like this");
  expect(screen.getAllByRole("button", { name: /^Related / })).toHaveLength(6);
  expect(screen.getByTestId(TEST_IDS.showCard(9005))).toBeOnTheScreen();
  expect(screen.queryByTestId(TEST_IDS.showCard(9006))).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Related 5" }));
  expect(router.push).toHaveBeenCalledWith("/show/9005");
});

function confirmSeasonTwo() {
  const choices = { onPrimary: jest.fn(), onSecondary: jest.fn() };
  confirm({ ...seasonConfirmation({ number: 2, airedCount: 6, completedCount: 3 }), ...choices });
  return choices;
}

describe("platform confirmations", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    jest.restoreAllMocks();
  });
  it("uses the iOS action sheet for remaining, rewatch and cancel", () => {
    Platform.OS = "ios";
    const present = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => {});
    const { onPrimary, onSecondary } = confirmSeasonTwo();
    expect(present.mock.calls[0]?.[0]).toEqual({
      title: "Mark Season 2 watched?",
      message: "3 of 6 episodes are unwatched.",
      options: ["Mark 3 remaining", "Mark all 6 again (rewatch)", "Cancel"],
      cancelButtonIndex: 2,
    });
    present.mock.calls[0]?.[1](1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it("uses the Android dialog's neutral, negative and positive buttons for three choices", () => {
    Platform.OS = "android";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { onPrimary, onSecondary } = confirmSeasonTwo();
    const [title, message, buttons] = alert.mock.calls[0] ?? [];
    expect([title, message]).toEqual(["Mark Season 2 watched?", "3 of 6 episodes are unwatched."]);
    expect(buttons?.map((button) => button.text)).toEqual([
      "Mark all 6 again (rewatch)",
      "Cancel",
      "Mark 3 remaining",
    ]);
    buttons?.[2]?.onPress?.();
    expect(onPrimary).toHaveBeenCalledTimes(1);
    buttons?.[0]?.onPress?.();
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it.each(["ios", "android"] as const)("uses plain two-button alerts on %s", (os) => {
    Platform.OS = os;
    const alert = jest.spyOn(Alert, "alert");
    for (const completedCount of [0, 8]) {
      confirm({
        ...seasonConfirmation({ number: 1, airedCount: 8, completedCount }),
        onPrimary: jest.fn(),
      });
      expect(alert.mock.lastCall?.[2]?.map((button) => [button.text, button.style])).toEqual([
        ["Cancel", "cancel"],
        [completedCount === 0 ? "Mark 8 episodes" : "Remove 8 episodes", undefined],
      ]);
    }
  });
});
