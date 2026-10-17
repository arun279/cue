import * as snackbarPolicy from "@cue/core/stores/snackbar-policy";
import {
  dismissSnack,
  showSnack,
  showUndoable,
  useSnackbar,
} from "@cue/core/stores/snackbar-store";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { AUTO_DISMISS_UNDO } from "../../src/ui/snackbar-policy.harness";
import { SPACE } from "../../src/ui/tokens";

let mockTraktBase: string | undefined;
jest.mock("../../src/config", () => ({
  get TRAKT_BASE_OVERRIDE() {
    return mockTraktBase;
  },
}));

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const MESSAGE = "Harbor Lights S3 E5 marked";

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  mockTraktBase = undefined;
  dismissSnack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

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

it.each([
  ["root", { ios: 104, android: 112 }],
  ["presentation", { ios: 32, android: 32 }],
  ["sheet", { ios: 32, android: 8 }],
] as const)("floats the %s snackbar at its bottom edge", async (placement, bottom) => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      <SnackbarHost placement={placement} />
    </SafeAreaProvider>,
  );
  await act(async () => showSnack({ message: MESSAGE }));

  expect(screen.getByTestId("snackbar")).toHaveStyle({
    position: "absolute",
    left: SPACE.s3,
    right: SPACE.s3,
    bottom: Platform.select(bottom),
  });
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

it.each([
  "presentation",
  "sheet",
] as const)("keeps the %s above a root host that mounts later", async (placement) => {
  await render(
    <View>
      <View testID="sheet-host">
        <SnackbarHost placement={placement} />
      </View>
      <View testID="root-host">
        <SnackbarHost placement="root" />
      </View>
    </View>,
  );
  await act(async () => showSnack({ message: MESSAGE }));
  expect(screen.getAllByTestId("snackbar")).toHaveLength(1);
  expect(screen.getByTestId("sheet-host")).toContainElement(screen.getByTestId("snackbar"));
});

it("expires while every host is unmounted", async () => {
  jest.useFakeTimers();
  const { unmount } = await render(<SnackbarHost placement="presentation" />);
  await act(async () => showSnack({ message: MESSAGE, timeoutMs: 5000 }));
  await unmount();
  await act(async () => jest.advanceTimersByTime(5000));
  await render(<SnackbarHost placement="root" />);
  expect(screen.queryByTestId("snackbar")).toBeNull();
});

function undo() {
  return { label: "Undo", testId: "snackbar-undo", onPress: jest.fn() };
}

function backfill() {
  return { label: "+2 earlier", testId: "snackbar-backfill", onPress: jest.fn() };
}

it.each([
  undefined,
  "http://127.0.0.1:8787",
])("renders a non-Undo message and expires at the normal deadline with API %s", async (base) => {
  jest.useFakeTimers();
  mockTraktBase = base;
  await render(<SnackbarHost placement="root" />);
  await act(async () =>
    showSnack({ message: { subject: "The Lantern Keeper", predicate: " added to Watchlist" } }),
  );
  expect(screen.getByTestId("snackbar-message")).toHaveTextContent(
    "The Lantern Keeper added to Watchlist",
  );
  await act(async () => jest.advanceTimersByTime(4999));
  expect(screen.getByTestId("snackbar")).toBeOnTheScreen();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("snackbar")).toBeNull();
});

it("keeps a message for fifteen seconds when the screen reader query resolves true", async () => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  await act(async () => showUndoable(MESSAGE, jest.fn()));
  const { rerender } = await render(<Hosts sheetOpen={false} />);

  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.queryByTestId("snackbar")).toBeOnTheScreen();
  await rerender(<Hosts sheetOpen />);
  await act(async () => jest.advanceTimersByTime(9999));
  expect(screen.queryByTestId("snackbar")).toBeOnTheScreen();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("snackbar")).toBeNull();
});

it("keeps harness Undo until it is acted on, even if rendering or the runner stalls", async () => {
  jest.useFakeTimers();
  jest.replaceProperty(snackbarPolicy, "AUTO_DISMISS_UNDO", AUTO_DISMISS_UNDO);
  mockTraktBase = "http://127.0.0.1:8787";
  const onUndo = jest.fn();
  const user = userEvent.setup();
  await act(async () => showUndoable(MESSAGE, onUndo));
  await act(async () => jest.runOnlyPendingTimers());
  expect(useSnackbar.getState().snack).not.toBeNull();

  await render(<SnackbarHost placement="root" />);
  await act(async () => jest.runOnlyPendingTimers());
  expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
  await user.press(screen.getByTestId("snackbar-undo"));
  expect(onUndo).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("snackbar")).toBeNull();
});

it("still expires harness messages that do not offer Undo", async () => {
  jest.useFakeTimers();
  jest.replaceProperty(snackbarPolicy, "AUTO_DISMISS_UNDO", AUTO_DISMISS_UNDO);
  await render(<SnackbarHost placement="root" />);
  await act(async () => showSnack({ message: MESSAGE }));
  await act(async () => jest.advanceTimersByTime(4999));
  expect(screen.getByTestId("snackbar")).toBeOnTheScreen();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("snackbar")).toBeNull();
});
