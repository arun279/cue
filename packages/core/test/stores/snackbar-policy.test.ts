import {
  dismissSnack,
  showSnack,
  showUndoable,
  useSnackbar,
} from "@cue/core/stores/snackbar-store";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@cue/core/stores/snackbar-policy", () => ({ AUTO_DISMISS_UNDO: false }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dismissSnack();
  vi.useRealTimers();
});

it.each([
  { actions: undefined },
  { actions: [{ label: "Dismiss", onPress: () => {} }] },
])("cancels the previous timer when persistent Undo replaces a message with actions $actions", ({
  actions,
}) => {
  showSnack({ message: "First", actions });
  vi.advanceTimersByTime(1000);
  showUndoable("Second", vi.fn());
  vi.runAllTimers();
  expect(useSnackbar.getState().snack?.message).toBe("Second");

  showSnack({ message: "Third", actions });
  vi.runAllTimers();
  expect(useSnackbar.getState().snack).toBeNull();
});
