import { renderHook } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { useNavigationTheme } from "../../src/ui/navigation-theme";
import { PALETTE } from "../../src/ui/tokens";

const scheme = jest.mocked(useColorScheme);

afterEach(() => scheme.mockReturnValue("light"));

async function themeUnder(value: "light" | "dark") {
  scheme.mockReturnValue(value);
  const { result } = await renderHook(() => useNavigationTheme());
  return result.current;
}

it("gives the navigators the scheme's own fill and ink rather than the library's", async () => {
  // The bar is a UIKit surface configured through props, so it resolves what it
  // is handed once: a dynamic color there leaves a dark title on a dark fill.
  const dark = await themeUnder("dark");
  expect(dark.dark).toBe(true);
  expect(dark.colors.card).toBe(PALETTE.bg.dark);
  expect(dark.colors.text).toBe(PALETTE.fg.dark);

  const light = await themeUnder("light");
  expect(light.dark).toBe(false);
  expect(light.colors.card).toBe(PALETTE.bg.light);
  expect(light.colors.text).toBe(PALETTE.fg.light);
});
