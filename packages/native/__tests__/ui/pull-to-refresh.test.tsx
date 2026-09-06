import { act, renderHook } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { usePullToRefresh } from "../../src/hooks/usePullToRefresh";
import { fakeRuntime, Harness, spyHaptics } from "../support/up-next";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
// The shared 429 pause is the gesture's own gate, and nothing in a test runner
// opens one. Its behavior is proved in the core; what this file owns is what a
// pull does while it stands.
jest.mock("@cue/core/data/trakt/read-budget", () => ({
  ...jest.requireActual("@cue/core/data/trakt/read-budget"),
  readsPausedUntil: jest.fn(() => 0),
}));

const { readsPausedUntil } = require("@cue/core/data/trakt/read-budget") as {
  readsPausedUntil: jest.Mock<number, [], unknown>;
};

const haptics = spyHaptics();
const PAUSE_MS = 42_000;

async function mount(flushWrites: () => Promise<number>) {
  const runtime = { ...fakeRuntime({}), flushWrites };
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
    <Harness runtime={runtime} haptics={haptics}>
      {children}
    </Harness>
  );
  return await renderHook(() => usePullToRefresh(), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  readsPausedUntil.mockReturnValue(0);
});

/**
 * The gesture and the nav bar item run one pass, and a pull the app cannot
 * honour ends rather than pretending. Both halves matter: a refresh that spins
 * against a closed rate limit window is the honesty gap this hook closes, and
 * two entry points that do different things is the divergence it prevents.
 */
describe("pull to refresh", () => {
  it("runs the one manual sync pass, and shows it running", async () => {
    const flushWrites = jest.fn(() => Promise.resolve(0));
    const { result } = await mount(flushWrites);

    await act(async () => {
      result.current.pull();
    });

    expect(flushWrites).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
    expect(haptics.warning).not.toHaveBeenCalled();
  });

  it("ends immediately on cached data inside a rate limit pause, and says so in the fingers", async () => {
    const flushWrites = jest.fn(() => Promise.resolve(0));
    const { result } = await mount(flushWrites);
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);

    await act(async () => {
      result.current.pull();
    });

    expect(result.current.refreshing).toBe(false);
    expect(haptics.warning).toHaveBeenCalledTimes(1);
    expect(flushWrites).not.toHaveBeenCalled();
  });

  it("reads the pause at the moment of release, not at the last render", async () => {
    const flushWrites = jest.fn(() => Promise.resolve(0));
    const { result } = await mount(flushWrites);

    // The window opens while the screen sits, with no render in between.
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);
    await act(async () => {
      result.current.pull();
    });

    expect(flushWrites).not.toHaveBeenCalled();
  });

  it("gives the nav bar item the same pass, so the two cannot drift", async () => {
    const flushWrites = jest.fn(() => Promise.resolve(0));
    const { result } = await mount(flushWrites);

    await act(async () => {
      result.current.sync();
    });

    expect(flushWrites).toHaveBeenCalledTimes(1);
  });
});
