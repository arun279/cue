import { act, renderHook, screen } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { usePullToRefresh } from "../../src/hooks/usePullToRefresh";
import { AppIdle } from "../../src/ui/AppIdle";
import { HARNESS_IDS } from "../../src/ui/harness-ids";
import { fakeRuntime, Harness, held, spyHaptics } from "../support/up-next";

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
  const runtime = {
    ...fakeRuntime({}),
    flushWrites,
    pollActivities: async () => ({ keys: [], commit: async () => {} }),
  };
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
    <Harness runtime={runtime} haptics={haptics}>
      {children}
      <AppIdle />
    </Harness>
  );
  return await renderHook(() => usePullToRefresh(), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  readsPausedUntil.mockReturnValue(0);
});

/**
 * A pull runs the manual sync pass and shows the platform indicator for as long
 * as that pass runs, and a pull the app cannot honour ends rather than pretending.
 */
describe("pull to refresh", () => {
  it("shows the indicator exactly while the sync pass runs", async () => {
    const flush = held<number>();
    const { result } = await mount(flush.call);

    await act(async () => {
      result.current.pull();
    });

    expect(flush.call).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    expect(haptics.warning).not.toHaveBeenCalled();

    await act(async () => flush.release(0));

    expect(result.current.refreshing).toBe(false);
  });

  it("ends immediately on cached data inside a rate limit pause, and says so in the fingers", async () => {
    const flushWrites = jest.fn(() => Promise.resolve(0));
    const { result } = await mount(flushWrites);
    // Opened while the screen sits, with no render in between: what matters is
    // the window at the moment of release, not the one the last render saw.
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);

    await act(async () => {
      result.current.pull();
    });

    expect(result.current.refreshing).toBe(false);
    expect(haptics.warning).toHaveBeenCalledTimes(1);
    expect(flushWrites).not.toHaveBeenCalled();
  });
});

it("publishes one durable receipt for a pull", async () => {
  const { result } = await mount(async () => 0);
  const before = screen.getByTestId(HARNESS_IDS.operationStarted).props["accessibilityLabel"];
  const next = Number(before.match(/sync ([0-9]+)/)[1]) + 1;
  await act(async () => result.current.pull());
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(`sync ${next} done;`),
  );
});
