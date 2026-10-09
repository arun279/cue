import { renderHook } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";
import { usePosterGrid } from "../src/screens/library/LibraryTile";
import { SPACE } from "../src/ui/tokens";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

async function gridAt(width: number, fontScale: number) {
  jest.mocked(useWindowDimensions).mockReturnValue({ width, height: 874, scale: 3, fontScale });
  return (await renderHook(() => usePosterGrid())).result.current;
}

it.each([
  ["the default size", 1, 3],
  ["XXXL", 1.353, 3],
  ["AX2", 2.143, 2],
  ["AX5", 3.571, 1],
])("sets the poster grid in fewer columns as text grows, at %s", async (_size, scale, columns) => {
  for (const width of [375, 402]) {
    const grid = await gridAt(width, scale);
    expect(grid.columns).toBe(columns);
    expect(grid.columns * grid.width + (grid.columns - 1) * SPACE.s3).toBeLessThanOrEqual(
      width - 2 * SPACE.s4,
    );
  }
});
