import { focusManager, QueryObserver } from "@tanstack/react-query";
import type { NetworkState } from "expo-network";
import { AppState, type AppStateStatus } from "react-native";
import { createAppQueryClient } from "../src/platform/query-client";
import { connectQueryManagers } from "../src/platform/query-managers";

const mockNetwork: {
  atLaunch: NetworkState | Promise<NetworkState>;
  announce: (state: NetworkState) => void;
} = {
  atLaunch: { isConnected: true },
  announce: () => {},
};

jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => Promise.resolve(mockNetwork.atLaunch),
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    mockNetwork.announce = listener;
    return { remove: () => {} };
  },
}));

let announceAppState = (_status: AppStateStatus): void => {};

beforeEach(() => {
  mockNetwork.atLaunch = { isConnected: true };
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    announceAppState = listener;
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** A screen's read, on the app's own query client. */
function watchRead(refetchInterval?: number) {
  const client = createAppQueryClient();
  client.mount();
  const read = jest.fn(() => Promise.resolve("data"));
  const unsubscribe = new QueryObserver(client, {
    queryKey: ["read"],
    queryFn: read,
    refetchInterval,
  }).subscribe(() => {});
  return {
    read,
    stop: () => {
      unsubscribe();
      client.unmount();
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const launchOffline = async (): Promise<void> => {
  mockNetwork.atLaunch = { isConnected: false };
  connectQueryManagers();
  await settle();
};

const dropAfterLaunch = async (): Promise<void> => {
  connectQueryManagers();
  await settle();
  mockNetwork.announce({ isConnected: false });
};

it.each([
  ["launches without a connection", launchOffline],
  ["loses its connection", dropAfterLaunch],
])("holds reads while the device %s, and sends them on reconnect", async (_, goOffline) => {
  await goOffline();
  const { read, stop } = watchRead();
  await settle();
  expect(read).not.toHaveBeenCalled();

  mockNetwork.announce({ isConnected: true });
  await settle();
  expect(read).toHaveBeenCalledTimes(1);
  stop();
});

it.each([
  [{ isConnected: false }, "offline"],
  [{ isConnected: true, isInternetReachable: false }, "offline"],
  [{ isConnected: true, isInternetReachable: null }, "online"],
  [{}, "online"],
])("treats a network state of %j as %s", async (state, expected) => {
  connectQueryManagers();
  await settle();
  mockNetwork.announce(state as NetworkState);
  const { read, stop } = watchRead();
  await settle();
  expect(read).toHaveBeenCalledTimes(expected === "online" ? 1 : 0);
  stop();
});

it("keeps a network change that lands before the launch read answers", async () => {
  const launch = Promise.withResolvers<NetworkState>();
  mockNetwork.atLaunch = launch.promise;
  connectQueryManagers();
  mockNetwork.announce({ isConnected: false });
  launch.resolve({ isConnected: true });
  await settle();
  const { read, stop } = watchRead();
  await settle();
  expect(read).not.toHaveBeenCalled();
  stop();
});

it("starts in the background when the app launches there", async () => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "queueMicrotask", "nextTick"] });
  jest.replaceProperty(AppState, "currentState", "background");
  connectQueryManagers();
  const { read, stop } = watchRead(1000);
  await jest.advanceTimersByTimeAsync(3000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
});

it("stops interval refetches while the app is inactive or in the background, and resumes in the foreground", async () => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "queueMicrotask", "nextTick"] });
  connectQueryManagers();
  const { read, stop } = watchRead(1000);
  await jest.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(3);

  for (const away of ["inactive", "background"] as const) {
    announceAppState(away);
    await jest.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(3);
  }

  announceAppState("active");
  await jest.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(4);
  stop();
});
