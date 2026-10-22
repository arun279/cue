import { MenuView } from "@expo/ui/community/menu";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, Pressable, Text } from "react-native";
import { RowMenu } from "../../src/ui/RowMenu";

jest.mock("expo-router", () => require("../support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: jest.fn(require("../support/native-ui").menuModule().MenuView),
}));

const items = [
  { id: "mark", label: "Mark S1 E2 watched", available: false, onPress: jest.fn() },
  { id: "stop", label: "Stop show", onPress: jest.fn() },
];

beforeEach(() => jest.clearAllMocks());

async function paintRow(onPress = jest.fn()): Promise<void> {
  await render(
    <RowMenu
      title="Salt Air"
      testID="menu"
      items={items}
      item={{ href: "/show/1", label: "Salt Air, S1 E2", testID: "row" }}
    >
      {(trigger, rowTestID) => (
        <>
          <Pressable testID={rowTestID} accessibilityLabel="Salt Air, S1 E2" onPress={onPress}>
            <Text>Salt Air</Text>
          </Pressable>
          {trigger}
        </>
      )}
    </RowMenu>,
  );
}

it("opens a row's menu by long press on iOS and from one more icon on Android", async () => {
  const onPress = jest.fn();
  await paintRow(onPress);

  const more = screen.queryAllByRole("button", { name: "More actions for Salt Air" });
  expect(more).toHaveLength(Platform.OS === "ios" ? 0 : 1);
  await fireEvent.press(screen.getByText("Salt Air", { includeHiddenElements: true }));
  expect(onPress).toHaveBeenCalledTimes(1);

  if (Platform.OS === "android") await fireEvent.press(screen.getByTestId("menu"));
  await fireEvent.press(screen.getByLabelText("Stop show"));
  expect(items[1]?.onPress).toHaveBeenCalledTimes(1);
});

it("keeps the row reachable by its id and actions where the platform menu hides it", async () => {
  await paintRow();

  const row = screen.getByTestId("row");
  expect(row.props["accessibilityLabel"]).toBe("Salt Air, S1 E2");
  if (Platform.OS === "ios") {
    expect(row.props["accessibilityActions"]).toEqual([{ name: "stop", label: "Stop show" }]);
    await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "stop" } });
    expect(items[1]?.onPress).toHaveBeenCalledTimes(1);
  }
});

it("mounts no menu host for a row until its menu is opened", async () => {
  await paintRow();

  expect(MenuView).not.toHaveBeenCalled();
  if (Platform.OS === "android") {
    await fireEvent.press(screen.getByTestId("menu"));
    expect(MenuView).toHaveBeenCalled();
  }
});

it("hides an unavailable item on iOS and disables it on Android", async () => {
  await paintRow();
  if (Platform.OS === "android") await fireEvent.press(screen.getByTestId("menu"));

  const mark = screen.queryByLabelText("Mark S1 E2 watched");
  if (Platform.OS === "ios") expect(mark).toBeNull();
  else expect(mark?.props["accessibilityState"]).toEqual({ disabled: true });
});

it("puts a tap menu with no trigger of its own behind the platform's more icon", async () => {
  await render(<RowMenu title="Salt Air" items={items} />);

  expect(screen.getByRole("button", { name: "More actions for Salt Air" })).toBeOnTheScreen();
});
