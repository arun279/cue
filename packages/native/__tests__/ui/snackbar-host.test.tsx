import { dismissSnack, showSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, View } from "react-native";
import { SnackbarHost } from "../../src/ui/SnackbarHost";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const MESSAGE = "Harbor Lights S3 E5 marked";

beforeEach(() => dismissSnack());
afterEach(() => jest.useRealTimers());

it("draws the message and every action as a target of its own", async () => {
  await render(<SnackbarHost placement="root" />);
  await act(async () => showSnack({ message: MESSAGE, actions: [undo(), backfill()] }));

  expect(screen.getByTestId("snackbar-message")).toHaveTextContent(MESSAGE);
  expect(screen.getByLabelText("Undo")).toBe(screen.getByTestId("snackbar-undo"));
  expect(screen.getByLabelText("+2 earlier")).toBe(screen.getByTestId("snackbar-backfill"));
});

it("runs an action from its own tap", async () => {
  const user = userEvent.setup();
  const action = undo();
  await render(<SnackbarHost placement="root" />);
  await act(async () => showSnack({ message: MESSAGE, actions: [action] }));

  await user.press(screen.getByTestId("snackbar-undo"));

  expect(action.onPress).toHaveBeenCalledTimes(1);
});

it("draws in the topmost presentation only, and hands back when it closes", async () => {
  const { rerender } = await render(<Hosts sheetOpen={false} />);
  await act(async () => showSnack({ message: MESSAGE }));
  expect(screen.getByTestId("root-host")).toContainElement(screen.getByTestId("snackbar"));

  await rerender(<Hosts sheetOpen />);
  expect(screen.getAllByTestId("snackbar")).toHaveLength(1);
  expect(screen.getByTestId("sheet-host")).toContainElement(screen.getByTestId("snackbar"));

  await rerender(<Hosts sheetOpen={false} />);
  expect(screen.getByTestId("root-host")).toContainElement(screen.getByTestId("snackbar"));
});

it("clears itself on its own timer", async () => {
  jest.useFakeTimers();
  await render(<SnackbarHost placement="root" />);
  await act(async () => showSnack({ message: MESSAGE, timeoutMs: 5000 }));
  expect(screen.getByTestId("snackbar")).toBeOnTheScreen();

  await act(async () => jest.advanceTimersByTime(5000));

  expect(screen.queryByTestId("snackbar")).toBeNull();
  expect(useSnackbar.getState().snack).toBeNull();
});

it("does not restart the countdown when a presentation opens over it", async () => {
  jest.useFakeTimers();
  const { rerender } = await render(<Hosts sheetOpen={false} />);
  await act(async () => showSnack({ message: MESSAGE, timeoutMs: 5000 }));

  await act(async () => jest.advanceTimersByTime(4000));
  await rerender(<Hosts sheetOpen />);
  await act(async () => jest.advanceTimersByTime(1000));

  expect(screen.queryByTestId("snackbar")).toBeNull();
});

function Hosts({ sheetOpen }: { readonly sheetOpen: boolean }): ReactElement {
  return (
    <View>
      <View testID="root-host">
        <SnackbarHost placement="root" />
      </View>
      {sheetOpen ? (
        <View testID="sheet-host">
          <SnackbarHost placement="presentation" />
        </View>
      ) : null}
    </View>
  );
}

function undo() {
  return { label: "Undo", testId: "snackbar-undo", onPress: jest.fn() };
}

function backfill() {
  return { label: "+2 earlier", testId: "snackbar-backfill", onPress: jest.fn() };
}

it("keeps a message for fifteen seconds when the screen reader query resolves true", async () => {
  jest.useFakeTimers();
  const query = jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  await act(async () => showSnack({ message: MESSAGE }));
  const { rerender } = await render(<Hosts sheetOpen={false} />);

  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.queryByTestId("snackbar")).toBeOnTheScreen();
  await rerender(<Hosts sheetOpen />);
  await act(async () => jest.advanceTimersByTime(9999));
  expect(screen.queryByTestId("snackbar")).toBeOnTheScreen();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("snackbar")).toBeNull();
  query.mockRestore();
});
