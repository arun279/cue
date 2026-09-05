import { fireEvent, render } from "@testing-library/react-native";

const mockDismissAll = jest.fn();

jest.mock("expo-router", () => {
  const { createElement, Fragment } = require("react");
  const { View } = require("react-native");
  const Stack = ({ children }: { children: React.ReactNode }) =>
    createElement(Fragment, null, children);
  Stack.Screen = ({
    name,
    options,
  }: {
    name: string;
    options: { headerRight?: () => React.ReactNode };
  }) => createElement(View, { testID: `account-route-${name}` }, options.headerRight?.());
  return { Stack, useRouter: () => ({ dismissAll: mockDismissAll }) };
});

const AccountLayout = require("../app/(account)/_layout").default as () => React.JSX.Element;

describe("the account stack", () => {
  beforeEach(() => mockDismissAll.mockClear());

  it("lets the initial profile route dismiss the modal", async () => {
    const account = await render(<AccountLayout />);

    expect(account.getByTestId("account-route-profile")).toBeOnTheScreen();
    fireEvent.press(account.getByRole("button", { name: "Done" }));
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });
});
