import { act, render, screen } from "@testing-library/react-native";
import { useFonts } from "expo-font";
import { hideAsync } from "expo-splash-screen";
import { bootNativeStores } from "../src/boot";
import { bulkBacking, legacyBacking, secureBacking } from "./support/native-stores";

// Every jest factory below is hoisted above the imports, so each one reaches its
// fake through `require` rather than through a binding that does not exist yet.
jest.mock("expo-secure-store", () => require("./support/native-stores").secureStoreModule);
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));
jest.mock("../modules/cue-native/src", () => require("./support/native-stores").cueNativeModule);
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
// Imported for its side effects by the reminders adapter, and on Android its
// push-registration module throws under this runner. The seam it fills is not
// what this file is about.
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationChannelAsync: () => Promise.resolve(null),
  requestPermissionsAsync: () => Promise.resolve({ granted: false }),
  getPermissionsAsync: () => Promise.resolve({ granted: false }),
  getAllScheduledNotificationsAsync: () => Promise.resolve([]),
  scheduleNotificationAsync: () => Promise.resolve(""),
  cancelScheduledNotificationAsync: () => Promise.resolve(),
  cancelAllScheduledNotificationsAsync: () => Promise.resolve(),
}));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: () => Promise.resolve(true),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("expo-font", () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock("../src/boot", () => ({
  ...jest.requireActual("../src/boot"),
  bootNativeStores: jest.fn(jest.requireActual("../src/boot").bootNativeStores),
}));
jest.mock("expo-application", () => ({
  nativeApplicationVersion: "1.2.3",
  nativeBuildVersion: "45",
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: () => Promise.resolve(new ArrayBuffer(32)),
  getRandomValues: (array: Uint8Array) => array,
  randomUUID: () => "an-install",
}));
// The navigator stands in for the whole route tree: what this file is about is
// which of the two branches the gate takes, not what the router then draws.
jest.mock("expo-router", () => {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  const Stack = () => createElement(Text, { testID: "router-stack" }, "routed");
  Stack.Screen = () => null;
  return { Stack, Link: Text, Redirect: () => null };
});

const TOKEN = JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
});

// Required rather than imported: the module reads its stores at import time, so
// it has to be loaded after the mocks above are in place.
const RootLayout = require("../app/_layout").default as () => React.JSX.Element;

/**
 * The composition root, rendered.
 *
 * What it has to get right is an ordering nothing else can check: the reinstall
 * purge and the Capacitor migration both change what the token store contains,
 * and the auth store reads that store the instant it is built. Build it too
 * early and a reinstalling user is signed in with a Keychain item their install
 * never wrote, or an upgrading user is dropped onto a sign-in screen with a
 * perfectly good token sitting beside them.
 */
describe("the native composition root", () => {
  beforeEach(() => {
    jest.mocked(hideAsync).mockClear();
    jest.mocked(useFonts).mockReturnValue([true, null]);
    bulkBacking.values.clear();
    secureBacking.clear();
    legacyBacking.clear();
  });

  it("shows sign-in on a fresh install, even with a Keychain item that outlived an uninstall", async () => {
    secureBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);

    expect(await screen.findByTestId("screen-onboarding")).toBeOnTheScreen();
    expect(screen.queryByTestId("router-stack")).toBeNull();
  });

  it("boots straight into the app when the Capacitor build left a token", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);

    expect(await screen.findByTestId("router-stack")).toBeOnTheScreen();
    expect(screen.queryByTestId("screen-onboarding")).toBeNull();
  });

  it("leaves the legacy token where it is, and takes the legacy op log away", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);
    legacyBacking.set("cue.write-queue", "[]");

    await render(<RootLayout />);
    await screen.findByTestId("router-stack");

    expect(legacyBacking.get("cue.trakt.token")).toBe(TOKEN);
    expect(legacyBacking.has("cue.write-queue")).toBe(false);
  });

  it("keeps the token out of the bulk store", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);
    await screen.findByTestId("router-stack");

    expect([...bulkBacking.values.keys()]).not.toContain("cue.trakt.token");
    expect(secureBacking.get("cue.trakt.token")).toBe(TOKEN);
  });
});

// The store boot is settled first so the only thing still holding the splash is
// the fonts, which is what these two cases are about. Left to resolve on its own
// it lands whenever the runner gets to it, and on a loaded one that is after the
// assertion below rather than before it.
it.each([
  null,
  new Error("Font unavailable"),
])("holds the splash until pending fonts settle with error %s", async (error) => {
  jest.mocked(hideAsync).mockClear();
  jest.mocked(useFonts).mockReturnValue([false, null]);
  const boot = Promise.withResolvers<Awaited<ReturnType<typeof bootNativeStores>>>();
  jest.mocked(bootNativeStores).mockReturnValueOnce(boot.promise);
  const { rerender } = await render(<RootLayout />);
  await act(async () =>
    boot.resolve({ purged: true, migration: { adoptedToken: false, adoptedOps: 0 } }),
  );

  expect(screen.getByTestId("boot-hold")).toBeOnTheScreen();
  expect(hideAsync).not.toHaveBeenCalled();

  jest.mocked(useFonts).mockReturnValue([error === null, error]);
  await rerender(<RootLayout />);

  expect(screen.queryByTestId("boot-hold")).toBeNull();
  expect(hideAsync).toHaveBeenCalledTimes(1);
});

it("holds the splash while stores are pending even if fonts have loaded", async () => {
  jest.mocked(hideAsync).mockClear();
  jest.mocked(useFonts).mockReturnValue([true, null]);
  const boot = Promise.withResolvers<Awaited<ReturnType<typeof bootNativeStores>>>();
  jest.mocked(bootNativeStores).mockReturnValueOnce(boot.promise);
  await render(<RootLayout />);

  expect(screen.getByTestId("boot-hold")).toBeOnTheScreen();
  expect(hideAsync).not.toHaveBeenCalled();

  await act(async () =>
    boot.resolve({ purged: true, migration: { adoptedToken: false, adoptedOps: 0 } }),
  );
  expect(screen.queryByTestId("boot-hold")).toBeNull();
  expect(hideAsync).toHaveBeenCalledTimes(1);
});
