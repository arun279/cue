import { render, renderHook, screen } from "@testing-library/react-native";
import * as Native from "react-native";
import Calendar from "../app/(tabs)/(calendar)/calendar";
import { useColors } from "../src/ui/tokens";

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Native.useColorScheme).mockReturnValue("light");
});

it.each([
  "light",
  "dark",
] as const)("makes an unfinished screen legible in %s without loading data", async (scheme) => {
  jest.mocked(Native.useColorScheme).mockReturnValue(scheme);
  const { result } = await renderHook(() => useColors());

  await render(<Calendar />);

  expect(screen.getByRole("header", { name: "Calendar" })).toHaveStyle({
    color: result.current.fg,
  });
  expect(screen.getByText("Calendar is coming soon.")).toHaveStyle({ color: result.current.ink2 });
  expect(screen.getAllByText(/.+/)).toHaveLength(2);
  expect(screen.queryByRole("button")).toBeNull();
});
