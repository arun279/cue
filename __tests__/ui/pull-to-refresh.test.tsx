import { act, renderHook } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import type { ActivitiesReconcile } from "@/core/runtime/runtime";
import { usePullToRefresh } from "../../src/hooks/usePullToRefresh";
import { fakeRuntime, Harness, held, spyHaptics } from "../support/up-next";

// The shared 429 pause is the gesture's own gate, and nothing in a test runner
// opens one. Its behavior is proved in the core; what this file owns is what a
// pull does while it stands.
jest.mock("@/core/data/trakt/read-budget", () => ({
  ...jest.requireActual("@/core/data/trakt/read-budget"),
  readsPausedUntil: jest.fn(() => 0),
}));

const { readsPausedUntil } = require("@/core/data/trakt/read-budget") as {
  readsPausedUntil: jest.Mock<number, [], unknown>;
};

const haptics = spyHaptics();
const PAUSE_MS = 42_000;

async function mount(pollActivities: () => Promise<ActivitiesReconcile>) {
  const runtime = { ...fakeRuntime({}), pollActivities };
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
 * A pull runs the manual sync pass and shows the platform indicator for as long
 * as that pass runs, and a pull the app cannot honour ends rather than pretending.
 */
describe("pull to refresh", () => {
  it("shows the indicator exactly while the sync pass runs", async () => {
    const poll = held<ActivitiesReconcile>();
    const { result } = await mount(poll.call);

    await act(async () => {
      result.current.pull();
    });

    expect(poll.call).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    expect(haptics.warning).not.toHaveBeenCalled();

    await act(async () => poll.release({ keys: [], commit: async () => {} }));

    expect(result.current.refreshing).toBe(false);
  });

  it("ends immediately on cached data inside a rate limit pause, and says so in the fingers", async () => {
    const pollActivities = jest.fn(async () => ({ keys: [], commit: async () => {} }));
    const { result } = await mount(pollActivities);
    // Opened while the screen sits, with no render in between: what matters is
    // the window at the moment of release, not the one the last render saw.
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);

    await act(async () => {
      result.current.pull();
    });

    expect(result.current.refreshing).toBe(false);
    expect(haptics.warning).toHaveBeenCalledTimes(1);
    expect(pollActivities).not.toHaveBeenCalled();
  });
});
