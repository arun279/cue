import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, Pressable, Text } from "react-native";
import { RowMenu } from "../../src/ui/RowMenu";

jest.mock("@expo/ui/community/menu", () => require("../support/native-ui").menuModule());

it("keeps an interactive Android child outside the native menu host", async () => {
  const onPress = jest.fn();
  await render(
    <RowMenu title="Salt Air" testID="menu" items={[]}>
      <Pressable testID="tile" onPress={onPress}>
        <Text>Salt Air</Text>
      </Pressable>
    </RowMenu>,
  );

  const menu = screen.getByTestId("menu");
  let parent = screen.getByTestId("tile").parent;
  while (parent !== null && parent !== menu) parent = parent.parent;
  expect(parent === menu).toBe(Platform.OS === "ios");
  expect(screen.queryByTestId("menu-trigger") === null).toBe(Platform.OS === "ios");
  fireEvent.press(screen.getByTestId("tile"));
  expect(onPress).toHaveBeenCalledTimes(1);
});
