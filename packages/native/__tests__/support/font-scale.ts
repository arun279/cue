import { useWindowDimensions } from "react-native";

/**
 * Dynamic Type in a renderer that has none.
 *
 * Every component that reflows reads the scale off `useWindowDimensions`, so a
 * test that wants the largest text size sets it there. The caller mocks the
 * module itself, because a jest mock factory has to be declared in the file it
 * applies to.
 */
export function atFontScale(fontScale: number): void {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 402, height: 874, scale: 3, fontScale });
}
