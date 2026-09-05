import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import type { UpNextCard, UpNextView } from "@cue/core/hooks/useUpNext";
import { UNDO_WINDOW_MS } from "@cue/core/sync-contract";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: Text };
});

let mockView: UpNextView;
let markedAt: number | null = null;
const mockMark: MarkWatched = {
  mark: jest.fn(() => Promise.resolve()),
  reverse: jest.fn(() => Promise.resolve()),
  reArm: jest.fn(),
  justMarkedAt: () => markedAt,
};

jest.mock("@cue/core/hooks/useUpNext", () => ({ useUpNext: () => mockView }));
jest.mock("@cue/core/hooks/useMarkWatched", () => ({ useMarkWatched: () => mockMark }));

const { UpNext } = require("../src/screens/UpNext") as typeof import("../src/screens/UpNext");

const SHOW_ID = 8801;

const episode = {
  season: 3,
  number: 6,
  title: "Salt Air",
  firstAired: "2026-01-01T00:00:00.000Z",
  still: null,
  ids: { trakt: 1 },
};

const entry: LibraryEntry = {
  showId: SHOW_ID,
  title: "Harbor Lights",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-01-01T00:00:00.000Z",
  aired: 22,
  completed: 20,
  nextEpisode: episode,
  lastAired: null,
  tmdbId: null,
  pendingAdvance: false,
};

const cardOf = (pendingAdvance: boolean): UpNextCard => ({
  item: { showId: SHOW_ID, title: entry.title, episode, lastWatchedAt: null, backlog: 2 },
  entry: { ...entry, pendingAdvance },
});

function viewOf(overrides: Partial<UpNextView> = {}): UpNextView {
  return {
    queue: [cardOf(false)],
    lapsedCards: [],
    watchlistEntries: [],
    totalCount: 1,
    trackedCount: 1,
    startedCount: 1,
    unresolvedCount: 0,
    refetch: jest.fn(),
    isLoading: false,
    isFetching: false,
    isError: false,
    hasData: true,
    syncedAt: 0,
    failure: null,
    retrying: false,
    ...overrides,
  };
}

const check = () => screen.getByTestId(`mark-watched-${SHOW_ID}`);
const state = () => screen.getByTestId(`mark-state-${SHOW_ID}`);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  markedAt = null;
  mockView = viewOf();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The native queue over the shared contract. What this owns is the ADOPTION: the
 * three states reaching the row's props, the contract's own labels used
 * verbatim, and `advancing` rendered as checked-and-disabled rather than as a
 * target that answers nothing. Deliberately not a snapshot: a snapshot of an
 * unstyled screen pins the markup, which is the part that is about to change,
 * and says nothing about the states, which are the part that must not.
 */
describe("the native queue's mark control", () => {
  it("arms the check with the contract's own label, and marks on press", async () => {
    await render(<UpNext />);

    expect(state()).toHaveTextContent("unwatched");
    expect(check()).toHaveAccessibleName("Mark Harbor Lights S3 E6 watched");
    expect(check()).toHaveProp("accessibilityState", { checked: false, disabled: false });

    fireEvent.press(check());
    expect(mockMark.mark).toHaveBeenCalledWith(cardOf(false).entry);
  });

  it("is green and reversible for the undo window, with nothing pending", async () => {
    markedAt = Date.now();
    mockView = viewOf({ queue: [cardOf(true)] });
    await render(<UpNext />);

    expect(state()).toHaveTextContent("just-marked");
    expect(check()).toHaveAccessibleName("Watched. Tap to remove.");
    expect(screen.queryByTestId(`mark-pending-${SHOW_ID}`)).toBeNull();

    fireEvent.press(check());
    expect(mockMark.reverse).toHaveBeenCalledWith(SHOW_ID);
  });

  it("advances on the clock into a checked, disabled row that reports the mark outstanding", async () => {
    markedAt = Date.now();
    mockView = viewOf({ queue: [cardOf(true)] });
    await render(<UpNext />);
    expect(state()).toHaveTextContent("just-marked");

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(state()).toHaveTextContent("advancing");
    expect(check()).toHaveAccessibleName("Watched. Not synced yet.");
    expect(check()).toHaveProp("accessibilityState", { checked: true, disabled: true });
    expect(screen.getByTestId(`mark-pending-${SHOW_ID}`)).toBeTruthy();

    // Inert, not a target that answers nothing: the next episode is a client
    // projection until a real read names it, so there is nothing honest to mark.
    fireEvent.press(check());
    expect(mockMark.mark).not.toHaveBeenCalled();
    expect(mockMark.reverse).not.toHaveBeenCalled();
  });
});

describe("the native queue's sync strip", () => {
  it("says nothing while sync is healthy", async () => {
    await render(<UpNext />);
    expect(screen.queryByTestId("sync-strip")).toBeNull();
  });

  it("renders the contract's line politely, and writes none of its own", async () => {
    mockView = viewOf({ isError: true, failure: { kind: "network" } });
    await render(<UpNext />);

    const strip = screen.getByTestId("sync-strip");
    expect(strip).toHaveTextContent("Can't reach Trakt. Showing your cached data.");
    expect(strip).toHaveProp("accessibilityLiveRegion", "polite");
  });

  it("keeps a blip the app is still chasing out of the outage line", async () => {
    mockView = viewOf({ isError: true, failure: { kind: "network" }, retrying: true });
    await render(<UpNext />);

    expect(screen.getByTestId("sync-strip")).toHaveTextContent(
      "Couldn't refresh from Trakt. Retrying…",
    );
  });

  it("puts the failure's own body under the error state when nothing is cached", async () => {
    mockView = viewOf({
      queue: [],
      isError: true,
      hasData: false,
      failure: { kind: "rate-limited", retryAfterMs: 1000 },
    });
    await render(<UpNext />);

    expect(screen.getByTestId("up-next-error")).toBeTruthy();
    expect(
      screen.getByText("Trakt is limiting requests. Cue will try again shortly."),
    ).toBeTruthy();
    expect(screen.queryByTestId("sync-strip")).toBeNull();
  });
});
