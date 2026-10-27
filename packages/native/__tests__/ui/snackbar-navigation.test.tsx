import { showUndoable } from "@cue/core/stores/snackbar-store";
import { router, Stack } from "expo-router";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { View } from "react-native";
import { SnackbarHost } from "../../src/ui/SnackbarHost";

afterEach(() => jest.useRealTimers());

it("keeps Undo across real navigation until its deadline", async () => {
  jest.useFakeTimers();
  await renderRouter(
    {
      _layout: () => (
        <>
          <Stack />
          <SnackbarHost placement="root" />
        </>
      ),
      index: () => <View />,
      settings: () => <View testID="settings-screen" />,
    },
    { initialUrl: "/" },
  );
  await act(() => showUndoable("First action", jest.fn()));
  await act(() => router.setParams({ filter: "watched" }));
  await act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();

  await act(() => router.push("/settings"));
  expect(screen.getByTestId("settings-screen")).toBeVisible();
  expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(4000));
  expect(screen.queryByTestId("snackbar")).toBeNull();
});
