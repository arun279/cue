import { render, renderHook, screen } from "@testing-library/react-native";
import * as Native from "react-native";
import Library from "../app/(tabs)/(library)/library";
import Search from "../app/(tabs)/(search)/search";
import { useColors } from "../src/ui/tokens";

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Native.useColorScheme).mockReturnValue("light");
});

it.each([
  "light",
  "dark",
] as const)("makes unfinished screens legible in %s without loading data", async (scheme) => {
  jest.mocked(Native.useColorScheme).mockReturnValue(scheme);
  const { result } = await renderHook(() => useColors());
  for (const [title, Screen] of [
    ["Library", Library],
    ["Search", Search],
  ] as const) {
    const view = await render(<Screen />);
    expect(screen.getByRole("header", { name: title })).toHaveStyle({ color: result.current.fg });
    expect(screen.getByText(`${title} is coming soon.`)).toHaveStyle({
      color: result.current.ink2,
    });
    expect(screen.getAllByText(/.+/)).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
    await view.unmount();
  }
});
