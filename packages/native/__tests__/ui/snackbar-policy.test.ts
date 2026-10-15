import type * as SnackbarStore from "@cue/core/stores/snackbar-store";
import { Linking } from "react-native";

jest.mock("react-native/Libraries/Linking/Linking", () => ({
  __esModule: true,
  default: { getInitialURL: jest.fn(), addEventListener: jest.fn() },
}));
jest.mock("@cue/core/stores/snackbar-policy", () =>
  require("../../src/ui/snackbar-policy.harness"),
);

let store: typeof SnackbarStore;

async function launch(url: string | null = null): Promise<void> {
  jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
  jest.isolateModules(() => {
    store = require("@cue/core/stores/snackbar-store");
  });
  await Promise.resolve();
}

function openLink(url: string): void {
  jest.mocked(Linking.addEventListener).mock.calls[0]?.[1]({ url });
}

function showUndo(): void {
  store.showSnack({
    message: "Marked",
    actions: [{ label: "Undo", testId: "snackbar-undo", onPress: jest.fn() }],
    timeoutMs: 15_000,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  store.dismissSnack();
  jest.useRealTimers();
});

it.each([
  null,
  "cue://",
  "cue://?keepUndo=0",
])("expires Undo without an opt-in link: %s", async (url) => {
  await launch(url);
  showUndo();
  jest.advanceTimersByTime(14_999);
  expect(store.useSnackbar.getState().snack).not.toBeNull();
  jest.advanceTimersByTime(1);
  expect(store.useSnackbar.getState().snack).toBeNull();
});

it.each(["initial", "event"])("keeps Undo after the %s link", async (source) => {
  await launch(source === "initial" ? "cue://?keepUndo=1" : null);
  if (source === "event") openLink("cue://?keepUndo=1");
  showUndo();
  jest.runOnlyPendingTimers();
  expect(store.useSnackbar.getState().snack).not.toBeNull();
  store.dismissSnack();
  expect(store.useSnackbar.getState().snack).toBeNull();
});

it("still expires messages without the Undo id after opting in", async () => {
  await launch("cue://?keepUndo=1");
  store.showSnack({ message: "Saved", actions: [{ label: "Undo", onPress: jest.fn() }] });
  jest.runOnlyPendingTimers();
  expect(store.useSnackbar.getState().snack).toBeNull();
});
