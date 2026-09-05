import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { act, render, screen } from "@testing-library/react-native";
import AccountLayout from "../app/(account)/_layout";

jest.mock("expo-router", () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return { Stack };
});
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

afterEach(() => dismissSnack());

it("draws snackbar feedback inside the account modal", async () => {
  await render(<AccountLayout />);
  await act(async () => showSnack({ message: "Removed 1 play, 2 remain" }));

  expect(screen.queryByTestId("snackbar")).toBeOnTheScreen();
  expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Removed 1 play, 2 remain");
});
