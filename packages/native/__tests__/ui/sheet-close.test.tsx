import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SheetClose } from "../../src/ui/SheetClose.android";
import { TARGET_MIN } from "../../src/ui/tokens";
import { router } from "../support/native-ui";

jest.mock("expo-router", () => require("../support/native-ui").expoRouterModule());

it("draws the Android sheet close labelled and at full touch size on its first frame", async () => {
  await render(<SheetClose />);

  const close = screen.getByRole("button", { name: "Close" });
  expect(StyleSheet.flatten(close.props["style"])).toMatchObject({
    width: TARGET_MIN,
    height: TARGET_MIN,
  });
  await fireEvent.press(close);
  expect(router.back).toHaveBeenCalledTimes(1);
});
