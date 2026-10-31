import { render, screen } from "@testing-library/react-native";
import { StyleSheet, type TextStyle } from "react-native";
import { MONOGRAM_SIZE, Poster } from "../../src/ui/Poster";
import { POSTER_WIDTH } from "../../src/ui/tokens";

/**
 * Inter draws no uppercase letter wider than three quarters of the em, so two
 * of them are the widest monogram `initialsOf` returns.
 */
const WIDEST_ADVANCE = 0.75;
/** The share of the plate that stays clear on each side, so no letter touches an edge. */
const MIN_INSET = 0.1;
const POSTER_RATIO = 3 / 2;

/** Every width a plate is drawn at: the three row widths, the lapsed tile, the related shelf. */
const WIDTHS = [...Object.values(POSTER_WIDTH), 96, 104];

/** A plate is artwork, so it stays out of the accessibility tree its letters sit in. */
const letters = () => screen.getByText("MC", { includeHiddenElements: true });
const monogram = (): TextStyle => StyleSheet.flatten(letters().props["style"]);

it.each(WIDTHS)("keeps the plate's edges clear at %i pt", async (width) => {
  const view = await render(<Poster title="Midnight Cartography" width={width} />);
  const { fontSize = 0, lineHeight = 0 } = monogram();

  expect(fontSize).toBeGreaterThan(0);
  expect(fontSize * 2 * WIDEST_ADVANCE).toBeLessThanOrEqual(width * (1 - MIN_INSET * 2));
  expect(lineHeight).toBeLessThanOrEqual(width * POSTER_RATIO * (1 - MIN_INSET * 2));
  expect(lineHeight).toBeGreaterThanOrEqual(fontSize);

  await view.unmount();
});

it("draws the monogram from the plate rather than from the text scale", async () => {
  await render(<Poster title="Midnight Cartography" width={POSTER_WIDTH.row} />);

  // A plate is the same size at every content size, so letters that grew with
  // Dynamic Type would run off one.
  expect(letters()).toHaveProp("allowFontScaling", false);
  expect(monogram().fontSize).toBe(POSTER_WIDTH.row * MONOGRAM_SIZE);
});
