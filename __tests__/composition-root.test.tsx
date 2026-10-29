import { dehydrate, onlineManager } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { hide } from "expo-splash-screen";
import { Profiler } from "react";
import { AccessibilityInfo, AppState, Text } from "react-native";
import * as runtimeBoot from "@/core/app/boot";
import { queryKeys } from "@/core/data/query-keys";
import { useActivitiesPoll } from "@/core/hooks/useActivitiesPoll";
import { sessionTeardown } from "@/core/runtime/session";
import { bootNativeStores } from "../src/boot";
import { persistBuster, queryClient, shouldDehydrateQuery } from "../src/platform/query-persister";
import { useScreenReader } from "../src/platform/screen-reader";
import {
  bulkBacking,
  legacyBacking,
  secureBacking,
  secureStoreModule,
} from "./support/native-stores";
import { entry, fakeRuntime, seedCalendars } from "./support/up-next";

// Every jest factory below is hoisted above the imports, so each one reaches its
// fake through `require` rather than through a binding that does not exist yet.
jest.mock("expo-secure-store", () => require("./support/native-stores").secureStoreModule);
jest.mock("../modules/cue-native/src", () => require("./support/native-stores").cueNativeModule);
// Its native module has no host under this runner: Android fails at import and
// iOS reports a tap that never happened.
jest.mock("expo-notifications", () => ({ useLastNotificationResponse: () => null }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: () => Promise.resolve(true),
  hide: jest.fn(),
}));
jest.mock("expo-font", () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock("../src/boot", () => ({
  ...jest.requireActual("../src/boot"),
  bootNativeStores: jest.fn(jest.requireActual("../src/boot").bootNativeStores),
}));
jest.mock("@/core/hooks/useActivitiesPoll", () => ({ useActivitiesPoll: jest.fn() }));
jest.mock("expo-application", () => ({
  nativeApplicationVersion: "1.2.3",
  nativeBuildVersion: "45",
}));
jest.mock("expo-updates", () => ({ updateId: "the-running-update" }));
let mockAnnounceNetwork: (state: { isConnected: boolean }) => void = () => {};
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true }),
  addNetworkStateListener: (listener: typeof mockAnnounceNetwork) => {
    mockAnnounceNetwork = listener;
    return { remove: () => {} };
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: () => Promise.resolve(new ArrayBuffer(32)),
  getRandomValues: (array: Uint8Array) => array,
  randomUUID: () => "an-install",
}));
jest.mock("expo-router", () => {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  const { DarkTheme, DefaultTheme } = jest.requireActual("expo-router");
  const native = require("./support/native-ui").expoRouterModule();
  const Stack = Object.assign(
    jest.fn(() => createElement(Text, { testID: "router-stack" }, "routed")),
    { Screen: () => null, Toolbar: native.Stack.Toolbar },
  );
  return {
    ...native,
    Stack,
    Redirect: () => null,
    DarkTheme,
    DefaultTheme,
    ThemeProvider: ({ children }: { children: unknown }) => children,
  };
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

afterEach(() => {
  queryClient.clear();
  jest.mocked(useActivitiesPoll).mockReset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/**
 * The composition root, rendered.
 *
 * What it has to get right is an ordering nothing else can check: the reinstall
 * purge and the legacy migration both change what the token store contains,
 * and the auth store reads that store the instant it is built. Build it too
 * early and a reinstalling user is signed in with a Keychain item their install
 * never wrote, or an upgrading user is dropped onto a sign-in screen with a
 * perfectly good token sitting beside them.
 */
describe("the native composition root", () => {
  beforeEach(() => {
    jest.mocked(hide).mockClear();
    jest.mocked(useFonts).mockReturnValue([true, null]);
    bulkBacking.values.clear();
    secureBacking.clear();
    legacyBacking.clear();
    jest.mocked(useActivitiesPoll).mockClear();
  });

  it("shows sign-in on a fresh install, even with a Keychain item that outlived an uninstall", async () => {
    secureBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);

    expect(await screen.findByTestId("screen-onboarding")).toBeOnTheScreen();
    expect(screen.queryByTestId("router-stack")).toBeNull();
  });

  it("tracks the screen reader from launch, for every snackbar to read", async () => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const Probe = () => <Text>{String(useScreenReader())}</Text>;

    await render(
      <>
        <RootLayout />
        <Probe />
      </>,
    );

    expect(await screen.findByText("true")).toBeOnTheScreen();
  });

  it("shows sign-in on a fresh install while the Keychain is still deleting the old token", async () => {
    secureBacking.set("cue.trakt.token", TOKEN);
    jest.spyOn(secureStoreModule, "deleteItemAsync").mockReturnValue(new Promise(() => {}));

    await render(<RootLayout />);

    expect(await screen.findByTestId("screen-onboarding")).toBeOnTheScreen();
  });

  it("reads the Keychain once on a returning launch", async () => {
    bulkBacking.values.set("cue.install-id", "an-earlier-install");
    secureBacking.set("cue.trakt.token", TOKEN);
    const read = jest.spyOn(secureStoreModule, "getItemAsync");

    await render(<RootLayout />);

    expect(await screen.findByTestId("router-stack")).toBeOnTheScreen();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("renders the persisted queue before any network response or timer", async () => {
    jest.replaceProperty(AppState, "currentState", "unknown");
    jest.useFakeTimers({
      now: new Date("2026-10-14T12:00:00Z"),
      doNotFake: ["queueMicrotask", "nextTick", "setImmediate"],
    });
    bulkBacking.values.set("cue.install-id", "an-earlier-install");
    secureBacking.set(
      "cue.trakt.token",
      JSON.stringify({ ...JSON.parse(TOKEN), created_at: Math.floor(Date.now() / 1000) }),
    );
    const cached = entry();
    queryClient.setQueryData(queryKeys.library(), { entries: [cached], isPartial: false });
    seedCalendars(queryClient, fakeRuntime({}));
    bulkBacking.values.set(
      "cue.query-cache",
      JSON.stringify({
        timestamp: Date.now(),
        buster: persistBuster,
        clientState: dehydrate(queryClient, { shouldDehydrateQuery }),
      }),
    );
    queryClient.clear();
    const fetch = jest.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const bootRenders = jest.spyOn(runtimeBoot, "useRuntimeBoot");
    jest
      .mocked(useActivitiesPoll)
      .mockImplementation(jest.requireActual("@/core/hooks/useActivitiesPoll").useActivitiesPoll);
    jest.mocked(Stack).mockImplementationOnce(require("../app/(tabs)/(up-next)").default);
    const commits = jest.fn();

    const view = await render(
      <Profiler id="startup" onRender={commits}>
        <RootLayout />
      </Profiler>,
    );

    expect(
      screen.getByLabelText("Harbor Lights, Aired last night, S3 E5, Salt Air, 3 left"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("up-next-skeleton")).toBeNull();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname).sort()).toEqual([
      "/sync/last_activities",
      "/users/settings",
    ]);
    expect(commits).toHaveBeenCalledTimes(4);
    expect(bootRenders).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it.each([
    ["an earlier build", "1.2.2 (44)"],
    ["an earlier update of this build", "1.2.3 (45)"],
  ])("drops a cache persisted by %s", async (_, buster) => {
    bulkBacking.values.set("cue.install-id", "an-earlier-install");
    secureBacking.set("cue.trakt.token", TOKEN);
    queryClient.setQueryData(queryKeys.library(), { entries: [entry()], isPartial: false });
    bulkBacking.values.set(
      "cue.query-cache",
      JSON.stringify({
        timestamp: Date.now(),
        buster,
        clientState: dehydrate(queryClient, { shouldDehydrateQuery }),
      }),
    );
    queryClient.clear();
    jest.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    await render(<RootLayout />);

    await waitFor(() => expect(bulkBacking.values.has("cue.query-cache")).toBe(false));
    expect(queryClient.getQueryData(queryKeys.library())).toBeUndefined();
  });

  it("tells the query layer when the device loses its connection", () => {
    mockAnnounceNetwork({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("boots straight into the app when the legacy store holds a token", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);

    expect(await screen.findByTestId("router-stack")).toBeOnTheScreen();
    expect(screen.queryByTestId("screen-onboarding")).toBeNull();
    expect(useActivitiesPoll).toHaveBeenCalled();
  });

  it("deletes everything the legacy store held once its token is adopted", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);
    legacyBacking.set("cue.write-queue", "[]");
    legacyBacking.set("cue.last-activities", "{}");

    await render(<RootLayout />);
    await screen.findByTestId("router-stack");

    expect(secureBacking.get("cue.trakt.token")).toBe(TOKEN);
    expect(legacyBacking.size).toBe(0);
  });

  it("deletes anything left in the legacy store when the session ends", async () => {
    bulkBacking.values.set("cue.install-id", "an-earlier-install");
    secureBacking.set("cue.trakt.token", TOKEN);
    await render(<RootLayout />);
    await screen.findByTestId("router-stack");
    legacyBacking.set("cue.trakt.token", TOKEN);

    await act(() => sessionTeardown.run());

    expect(legacyBacking.size).toBe(0);
  });

  it("keeps the token out of the bulk store", async () => {
    legacyBacking.set("cue.trakt.token", TOKEN);

    await render(<RootLayout />);
    await screen.findByTestId("router-stack");

    expect([...bulkBacking.values.keys()]).not.toContain("cue.trakt.token");
    expect(secureBacking.get("cue.trakt.token")).toBe(TOKEN);
  });

  // The two ways a store can refuse. Neither has a phase of its own, and a
  // launch that swallows either one ends on a gate rather than on a screen: the
  // app is up and responsive with nothing on it and no way off it.
  it("reaches a screen and says so when the store boot fails", async () => {
    jest.mocked(bootNativeStores).mockRejectedValueOnce(new Error("kv-store unavailable"));

    await render(<RootLayout />);

    expect(await screen.findByTestId("screen-onboarding")).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toBeOnTheScreen();
  });

  it("reaches a screen and says so when the Keychain refuses the token read", async () => {
    bulkBacking.values.set("cue.install-id", "an-earlier-install");
    jest
      .spyOn(secureStoreModule, "getItemAsync")
      .mockRejectedValue(new Error("errSecMissingEntitlement"));

    await render(<RootLayout />);

    expect(await screen.findByTestId("screen-onboarding")).toBeOnTheScreen();
    expect(screen.queryByTestId("auth-loading")).toBeNull();
    expect(screen.getByRole("alert")).toBeOnTheScreen();
  });
});

/**
 * Renders with the stores deliberately pending, so a test can settle them at a
 * chosen moment. The splash is held for two reasons at once, and a test that
 * controls only one of them asserts on whichever happens to settle first.
 */
const renderWithPendingStores = async () => {
  const boot = Promise.withResolvers<Awaited<ReturnType<typeof bootNativeStores>>>();
  jest.mocked(bootNativeStores).mockReturnValueOnce(boot.promise);
  const { rerender } = await render(<RootLayout />);

  expect(screen.getByTestId("boot-hold")).toBeOnTheScreen();
  expect(hide).not.toHaveBeenCalled();

  return {
    rerender,
    settleStores: () =>
      act(async () =>
        boot.resolve({ purged: true, migration: { adoptedToken: false, adoptedOps: 0 } }),
      ),
  };
};

it.each([
  null,
  new Error("Font unavailable"),
])("holds the splash until pending fonts settle with error %s", async (error) => {
  jest.mocked(hide).mockClear();
  jest.mocked(useFonts).mockReturnValue([false, null]);
  const { rerender, settleStores } = await renderWithPendingStores();

  await settleStores();
  expect(screen.getByTestId("boot-hold")).toBeOnTheScreen();
  expect(hide).not.toHaveBeenCalled();

  jest.mocked(useFonts).mockReturnValue([error === null, error]);
  await rerender(<RootLayout />);

  expect(screen.queryByTestId("boot-hold")).toBeNull();
  expect(hide).toHaveBeenCalledTimes(1);
});

it("holds the splash while stores are pending even if fonts have loaded", async () => {
  jest.mocked(hide).mockClear();
  jest.mocked(useFonts).mockReturnValue([true, null]);
  const { settleStores } = await renderWithPendingStores();

  await settleStores();
  expect(screen.queryByTestId("boot-hold")).toBeNull();
  expect(hide).toHaveBeenCalledTimes(1);
});
