import type { EpisodeRef } from "@cue/core/domain/model/library";
import { fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import * as Native from "react-native";
import { useShowArt } from "../src/hooks/useShowArt";
import { MarqueeCard } from "../src/screens/up-next/MarqueeCard";
import { TEST_IDS } from "../src/ui/test-ids";
import { HAIRLINE, useColors } from "../src/ui/tokens";
import { entry } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("../src/hooks/useShowArt", () => ({ useShowArt: jest.fn() }));

const episode: EpisodeRef = {
  season: 3,
  number: 5,
  title: "Salt Air",
  firstAired: "2020-01-01T00:00:00Z",
  still: null,
  ids: { trakt: 88105 },
};
const show = entry({ nextEpisode: episode });
const card = {
  entry: show,
  item: {
    showId: show.showId,
    title: show.title,
    episode,
    lastWatchedAt: show.lastWatchedAt,
    backlog: 3,
  },
};
const mark = {
  mark: jest.fn(async () => {}),
  reverse: jest.fn(async () => {}),
  reArm: jest.fn(),
  justMarkedAt: () => null,
};
const backdrop = "image.tmdb.org/t/p/w780/backdrop.jpg";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Native.Dimensions, "get").mockReturnValue({
    width: 400,
    height: 800,
    scale: 1,
    fontScale: 1,
  });
  jest.mocked(useShowArt).mockReturnValue({ posters: [], backdrops: [] });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Native.useColorScheme).mockReturnValue("light");
});

it.each([
  "light",
  "dark",
] as const)("keeps content through remote artwork failure in %s", async (scheme) => {
  jest.mocked(Native.useColorScheme).mockReturnValue(scheme);
  const { result } = await renderHook(() => useColors());
  const view = await render(<MarqueeCard card={card} episode={episode} mark={mark} />);
  expect(screen.getByText(show.title)).toHaveStyle({ color: result.current.fg });
  expect(screen.getByTestId(TEST_IDS.marqueeCard)).toHaveStyle({ borderWidth: HAIRLINE });
  jest.mocked(useShowArt).mockReturnValue({ posters: [], backdrops: [backdrop] });
  await view.rerender(<MarqueeCard card={card} episode={episode} mark={mark} />);
  expect(screen.getByTestId(TEST_IDS.marqueeBackdrop)).toHaveProp("source", {
    uri: `https://${backdrop}`,
  });
  expect(screen.getByTestId(TEST_IDS.marqueeCard)).toHaveStyle({ borderWidth: 0 });
  expect(screen.getByText(show.title)).toHaveStyle({ color: "#ffffff" });
  expect(screen.getByText("S3 E5 · Salt Air")).toBeOnTheScreen();
  expect(screen.getByText("3 left")).toBeOnTheScreen();

  await fireEvent(screen.getByTestId(TEST_IDS.marqueeBackdrop), "error", {
    nativeEvent: { error: "HTTP 404" },
  });
  expect(screen.queryByTestId(TEST_IDS.marqueeBackdrop)).toBeNull();
  expect(screen.getByText(show.title)).toHaveStyle({ color: result.current.fg });
  expect(screen.getByTestId(TEST_IDS.marqueeCard)).toHaveStyle({ borderWidth: HAIRLINE });
  expect(screen.getByText("Continue")).toHaveStyle({ color: result.current.accentInk });
  await fireEvent.press(screen.getByTestId(TEST_IDS.marqueeMark));
  expect(mark.mark).toHaveBeenCalledWith(show);

  jest.mocked(useShowArt).mockReturnValue({ posters: [], backdrops: [`${backdrop}?v=2`] });
  await view.rerender(<MarqueeCard card={card} episode={episode} mark={mark} />);
  expect(screen.getByTestId(TEST_IDS.marqueeBackdrop)).toHaveProp("source", {
    uri: `https://${backdrop}?v=2`,
  });
});

it("uses the plain composition for large text even when remote artwork exists", async () => {
  jest
    .spyOn(Native.Dimensions, "get")
    .mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 2 });
  jest.mocked(useShowArt).mockReturnValue({ posters: [], backdrops: [backdrop] });
  await render(<MarqueeCard card={card} episode={episode} mark={mark} />);
  expect(screen.queryByTestId(TEST_IDS.marqueeBackdrop)).toBeNull();
  expect(screen.getByText(show.title)).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.marqueeMark)).toBeEnabled();
});
