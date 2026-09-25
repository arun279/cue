import type { KeyValueStore } from "@cue/core/ports/kv";
import { TOKEN_KEY } from "@cue/core/ports/storage-keys";
import { createTokenStore } from "@cue/core/ports/token-store";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { hide } from "expo-splash-screen";
import { Text } from "react-native";
import { RuntimeBoot } from "../src/screens/RuntimeBoot";
import { TARGET_MIN } from "../src/ui/tokens";

const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };

jest.mock("expo-splash-screen", () => ({ hide: jest.fn() }));
jest.mock("@cue/core/auth/store", () => {
  const state = { endSession: () => Promise.resolve() };
  return { useAuth: (select: (auth: typeof state) => unknown) => select(state) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => INSETS }));

const TOKEN = JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
});

/** The device's store, whose reads a test can hold or refuse one at a time. */
function deviceStore(entries: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(entries));
  const read = jest.fn((key: string) => Promise.resolve(values.get(key) ?? null));
  const kv: KeyValueStore = {
    read,
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
  return { kv, read, values };
}

async function launch(kv: KeyValueStore): Promise<void> {
  await render(
    <RuntimeBoot
      deps={{
        newId: () => "op",
        tokenStore: createTokenStore(kv),
        kv,
        redirectUri: "cue://auth",
        clientId: "client",
        browser: false,
        clearPersistedCaches: () => Promise.resolve(),
        clearLocalPreferences: () => {},
      }}
    >
      <Text>queue</Text>
    </RuntimeBoot>,
  );
}

beforeEach(() => jest.clearAllMocks());

it("keeps the splash over a runtime that is still building, and draws nothing of its own", async () => {
  const store = deviceStore();
  store.read.mockReturnValue(new Promise(() => {}));
  await launch(store.kv);

  expect(hide).not.toHaveBeenCalled();
  expect(screen.queryByText(/./)).toBeNull();
});

it("lets the splash go onto the app once the runtime is built", async () => {
  await launch(deviceStore({ [TOKEN_KEY]: TOKEN }).kv);

  expect(await screen.findByText("queue")).toBeOnTheScreen();
  expect(hide).toHaveBeenCalledTimes(1);
});

it("fails onto a retry rather than holding the splash when no token is stored", async () => {
  await launch(deviceStore().kv);

  expect(await screen.findByRole("button", { name: "Retry" })).toBeOnTheScreen();
  expect(hide).toHaveBeenCalledTimes(1);
});

it("lets the splash go onto a retry that clears the system bars, and again once the retry settles", async () => {
  const store = deviceStore({ [TOKEN_KEY]: TOKEN });
  store.read.mockRejectedValueOnce(new Error("Keychain locked"));
  await launch(store.kv);

  const retryButton = await screen.findByRole("button", { name: "Retry" });
  expect(hide).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("runtime-error")).toHaveStyle({
    paddingTop: INSETS.top,
    paddingBottom: INSETS.bottom,
  });
  expect(retryButton).toHaveStyle({ minHeight: TARGET_MIN });

  const read = Promise.withResolvers<string | null>();
  store.read.mockReturnValueOnce(read.promise);
  await fireEvent.press(retryButton);
  expect(screen.queryByText(/./)).toBeNull();
  expect(hide).toHaveBeenCalledTimes(1);

  await act(async () => read.resolve(TOKEN));

  expect(await screen.findByText("queue")).toBeOnTheScreen();
  expect(hide).toHaveBeenCalledTimes(2);
});
