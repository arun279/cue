import * as snackbarPolicy from "@cue/core/stores/snackbar-policy";
import { showSnack, showUndoable, useSnackbar } from "@cue/core/stores/snackbar-store";
import { router, Stack } from "expo-router";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { View } from "react-native";
import { SnackbarRouteDismissal } from "../../src/ui/harness";
import { SnackbarRouteDismissal as StoreSnackbarRouteDismissal } from "../../src/ui/harness.store";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { AUTO_DISMISS_UNDO } from "../../src/ui/snackbar-policy.harness";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function paint(build: string) {
  jest.useFakeTimers();
  const Dismissal = build === "harness" ? SnackbarRouteDismissal : StoreSnackbarRouteDismissal;
  if (build === "harness")
    jest.replaceProperty(snackbarPolicy, "AUTO_DISMISS_UNDO", AUTO_DISMISS_UNDO);
  return renderRouter(
    {
      _layout: () => (
        <>
          <Stack />
          <SnackbarHost placement="root" />
          <Dismissal />
        </>
      ),
      index: () => <View />,
      settings: () => <View testID="settings-screen" />,
    },
    { initialUrl: "/" },
  );
}

it.each(["harness", "store"])("handles Undo across real navigation in %s builds", async (build) => {
  await paint(build);
  await act(() => showUndoable("First action", jest.fn()));
  await act(() => router.setParams({ filter: "watched" }));
  await act(() => jest.advanceTimersByTime(build === "harness" ? 120_000 : 1000));
  expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();

  await act(() => router.push("/settings"));
  expect(screen.getByTestId("settings-screen")).toBeVisible();
  if (build === "harness") {
    expect(screen.queryByTestId("snackbar")).toBeNull();
    expect(useSnackbar.getState().snack).toBeNull();
    await act(() => showUndoable("Second action", jest.fn()));
    await act(() => router.setParams({ filter: "all" }));
    expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
    await act(() => router.back());
    expect(screen.queryByTestId("snackbar")).toBeNull();
  } else {
    expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTime(4000));
    expect(screen.queryByTestId("snackbar")).toBeNull();
  }
});

it("leaves non-Undo messages on their normal deadline when the harness route changes", async () => {
  await paint("harness");
  await act(() => showSnack({ message: "Sync complete" }));
  await act(() => router.push("/settings"));
  expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Sync complete");
  await act(() => jest.advanceTimersByTime(5000));
  expect(screen.queryByTestId("snackbar")).toBeNull();
});
