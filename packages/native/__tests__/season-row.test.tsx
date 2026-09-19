import type { EpisodeView, SeasonView } from "@cue/core/data/trakt/show-detail";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet, type TextStyle, useWindowDimensions } from "react-native";
import { SeasonRow } from "../src/screens/show-detail/SeasonRow";
import { EPISODE_NUMBER_WIDTH } from "../src/ui/tokens";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

const dimensions = jest.mocked(useWindowDimensions);

function atFontScale(fontScale: number): void {
  dimensions.mockReturnValue({ width: 402, height: 874, scale: 3, fontScale });
}

beforeEach(() => atFontScale(1));

const TITLES = [
  "Nightjar",
  "Small Debts",
  "Half Measures",
  "The Undertow",
  "Glass and Grain",
  "Low Tide",
  "Ridge Line",
  "Paper Compass",
  "Dead Reckoning",
  "Magnetic North",
  "True North",
  "Last Bearing",
];

const episode = (index: number): EpisodeView => ({
  season: 2,
  number: index + 1,
  title: TITLES[index] ?? null,
  firstAired: "2026-08-24T01:00:00.000Z",
  ids: { trakt: 880300 + index },
  stills: [],
  watched: false,
  watchedAt: null,
  aired: true,
});

const season: SeasonView = {
  number: 2,
  title: null,
  isSpecial: false,
  isHidden: false,
  episodes: TITLES.map((_, index) => episode(index)),
  airedCount: TITLES.length,
  completedCount: 0,
};

function renderSeason() {
  return render(
    <SeasonRow
      showId={8803}
      season={season}
      expanded
      onExpand={jest.fn()}
      onConfirm={jest.fn()}
      onOpen={jest.fn()}
      onMark={jest.fn()}
    />,
  );
}

const numbers = (): readonly TextStyle[] =>
  season.episodes.map((view) =>
    StyleSheet.flatten(screen.getByText(String(view.number)).props["style"]),
  );

it.each([
  1, 2.35,
])("gives every episode number the same column at a text scale of %s", async (fontScale) => {
  atFontScale(fontScale);
  await renderSeason();

  const widths = new Set(numbers().map((style) => style.width));
  expect(widths).toEqual(new Set([EPISODE_NUMBER_WIDTH * fontScale]));
});

it("holds the column open for two digits, in numerals that do not shift", async () => {
  await renderSeason();

  for (const style of numbers()) {
    expect(style.fontVariant).toContain("tabular-nums");
    // A `micro` digit is half an em wide at most, so a column an em across
    // holds two of them.
    expect(style.fontSize).toBeGreaterThan(0);
    expect(EPISODE_NUMBER_WIDTH).toBeGreaterThanOrEqual(style.fontSize ?? 0);
  }
});
