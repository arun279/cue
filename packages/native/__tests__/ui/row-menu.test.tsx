import { MenuView } from "@expo/ui/community/menu";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Platform, Pressable, Text } from "react-native";
import { RowMenu } from "../../src/ui/RowMenu";

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: jest.fn(require("../support/native-ui").menuModule().MenuView),
}));

const items = [
  { id: "mark", label: "Mark S1 E2 watched", available: false, onPress: jest.fn() },
  { id: "stop", label: "Stop show", onPress: jest.fn() },
];

beforeEach(() => jest.mocked(MenuView).mockClear());

it("opens a row's menu by long press on iOS and from one more icon on Android", async () => {
  const onPress = jest.fn();
  await render(
    <RowMenu title="Salt Air" testID="menu" items={items} contentWidth={320}>
      {(trigger) => (
        <>
          <Pressable testID="row" onPress={onPress}>
            <Text>Salt Air</Text>
          </Pressable>
          {trigger}
        </>
      )}
    </RowMenu>,
  );

  const menu = screen.getByTestId("menu");
  const more = screen.queryAllByRole("button", { name: "More actions for Salt Air" });
  expect(more).toHaveLength(Platform.OS === "ios" ? 0 : 1);
  expect(menu).toContainElement(
    Platform.OS === "ios" ? screen.getByTestId("row") : (more[0] ?? null),
  );
  if (Platform.OS === "android") expect(menu).not.toContainElement(screen.getByTestId("row"));
  expect(jest.mocked(MenuView).mock.calls[0]?.[0].shouldOpenOnLongPress).toBe(
    Platform.OS === "ios",
  );
  await fireEvent.press(screen.getByTestId("row"));
  expect(onPress).toHaveBeenCalledTimes(1);
  await fireEvent.press(within(menu).getByTestId("stop"));
  expect(items[1]?.onPress).toHaveBeenCalledTimes(1);
});

it("hides an unavailable item on iOS and disables it on Android", async () => {
  await render(<RowMenu title="Salt Air" items={items} />);

  expect(jest.mocked(MenuView).mock.calls[0]?.[0].actions[0]?.attributes).toEqual(
    Platform.OS === "ios" ? { hidden: true } : { disabled: true },
  );
});

it("puts a tap menu with no trigger of its own behind the platform's more icon", async () => {
  await render(<RowMenu title="Salt Air" items={items} />);

  expect(screen.getByRole("button", { name: "More actions for Salt Air" })).toBeOnTheScreen();
  expect(jest.mocked(MenuView).mock.calls[0]?.[0].shouldOpenOnLongPress).toBe(false);
});
