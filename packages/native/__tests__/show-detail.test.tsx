import { seasonConfirmation } from "@cue/core/domain/show-detail";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import { ShowDetail } from "../src/screens/ShowDetail";
import { ContinueBar } from "../src/screens/show-detail/ContinueBar";
import { ConfirmationSheet } from "../src/ui/ConfirmationSheet.android";
import { TEST_IDS } from "../src/ui/test-ids";
import { useConfirmation } from "../src/ui/useConfirmation";
import { DetailHarness } from "./support/detail";
import { entry, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("@expo/ui/jetpack-compose", () => require("./support/detail").composeModule());
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

describe("platform confirmations", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    jest.restoreAllMocks();
  });
  it("uses the iOS action sheet for remaining, rewatch and cancel", async () => {
    Platform.OS = "ios";
    const present = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => {});
    const { result } = await renderHook(useConfirmation);
    const onPrimary = jest.fn();
    const onSecondary = jest.fn();
    await act(() =>
      result.current.present({
        ...seasonConfirmation({ number: 2, airedCount: 6, completedCount: 3 }),
        onPrimary,
        onSecondary,
      }),
    );
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

  it("uses an Android modal bottom sheet for three choices", async () => {
    Platform.OS = "android";
    const alert = jest.spyOn(Alert, "alert");
    const { result } = await renderHook(useConfirmation);
    const onPrimary = jest.fn();
    await act(() =>
      result.current.present({
        ...seasonConfirmation({ number: 2, airedCount: 6, completedCount: 3 }),
        onPrimary,
        onSecondary: jest.fn(),
      }),
    );
    await render(
      <ConfirmationSheet
        confirmation={result.current.pending}
        onDismiss={result.current.dismiss}
      />,
    );
    expect(screen.getByTestId(TEST_IDS.confirmSheet)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(TEST_IDS.confirmSheetPrimary));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"] as const)("uses plain two-button alerts on %s", async (os) => {
    Platform.OS = os;
    const alert = jest.spyOn(Alert, "alert");
    const { result } = await renderHook(useConfirmation);
    for (const completedCount of [0, 8]) {
      await act(() =>
        result.current.present({
          ...seasonConfirmation({ number: 1, airedCount: 8, completedCount }),
          onPrimary: jest.fn(),
        }),
      );
      expect(alert.mock.lastCall?.[2]?.map((button) => [button.text, button.style])).toEqual([
        ["Cancel", "cancel"],
        [completedCount === 0 ? "Mark 8 episodes" : "Remove 8 episodes", undefined],
      ]);
    }
  });
});
