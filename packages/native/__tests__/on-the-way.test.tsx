import type { OnTheWayDay } from "@cue/core/domain/on-the-way";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet, useWindowDimensions, type ViewStyle } from "react-native";
import { OnTheWay } from "../src/screens/up-next/OnTheWay";
import { ROW_MIN_HEIGHT } from "../src/ui/tokens";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

const dimensions = jest.mocked(useWindowDimensions);

function atFontScale(fontScale: number): void {
  dimensions.mockReturnValue({ width: 402, height: 874, scale: 3, fontScale });
}

beforeEach(() => atFontScale(1));

const days: readonly OnTheWayDay[] = [
  {
    key: "2026-09-21",
    label: "Monday",
    offset: 2,
    rows: [
      {
        showId: 8803,
        showTitle: "Midnight Cartography",
        season: 2,
        number: 5,
        episodeTitle: "Glass and Grain",
        firstAired: "2026-09-21T01:00:00.000Z",
        ids: { trakt: 880305 },
        posters: [],
        network: "Tessellate",
        tmdbId: null,
        aired: false,
      },
    ],
  },
];

const rowStyle = (): ViewStyle =>
  StyleSheet.flatten(
    screen.getByRole("button", { name: /Midnight Cartography/ }).props["style"],
  ) as ViewStyle;

it.each([1, 2.35])("grows the airing row with its text at a scale of %s", async (fontScale) => {
  atFontScale(fontScale);
  await render(<OnTheWay days={days} />);

  const style = rowStyle();
  expect(style.minHeight).toBe(ROW_MIN_HEIGHT.onTheWay);
  // A height instead of a minimum is what crowds the lines into the divider
  // once the text no longer fits the row the design drew.
  expect(style.height).toBeUndefined();
  expect(style.maxHeight).toBeUndefined();
});
