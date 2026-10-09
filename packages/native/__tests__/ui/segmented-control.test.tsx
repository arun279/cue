import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";
import { SegmentedControl, type SegmentOption } from "../../src/ui/SegmentedControl";
import { REFLOW_FONT_SCALE, TARGET_MIN } from "../../src/ui/tokens";
import { atFontScale } from "../support/font-scale";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

beforeEach(() => atFontScale(1));

type Medium = "shows" | "movies";

const SEGMENTS: readonly SegmentOption<Medium>[] = [
  { value: "shows", label: "Shows", testID: "segment-shows" },
  { value: "movies", label: "Movies", testID: "segment-movies" },
];

function Harness() {
  const [value, setValue] = useState<Medium>("shows");
  return <SegmentedControl<Medium> segments={SEGMENTS} value={value} onChange={setValue} />;
}

it("is a tab list whose tabs carry their label and selected state", async () => {
  await render(<Harness />);

  expect(screen.getByTestId("segment-shows").parent).toHaveProp("accessibilityRole", "tablist");
  expect(screen.getByRole("tab", { name: "Shows", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Movies", selected: false })).toBeOnTheScreen();
});

it("moves the selection to the tab that is pressed", async () => {
  await render(<Harness />);

  await userEvent.press(screen.getByTestId("segment-movies"));

  expect(screen.getByRole("tab", { name: "Movies", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Shows", selected: false })).toBeOnTheScreen();
});

it("keeps each tab at the platform's minimum target", async () => {
  await render(<Harness />);

  expect(screen.getByTestId("segment-shows")).toHaveStyle({ minHeight: TARGET_MIN });
});

it("stacks its tabs at the reflow text size", async () => {
  atFontScale(REFLOW_FONT_SCALE);
  await render(<Harness />);

  expect(screen.getByTestId("segment-shows").parent).toHaveStyle({ flexDirection: "column" });
});
