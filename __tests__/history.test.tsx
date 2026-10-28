import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { historyRange } from "@/core/domain/history";
import type { CueRuntime, SubmitOutcome } from "@/core/runtime/runtime";
import { HistoryScreen } from "../src/screens/history/HistoryScreen";
import { HISTORY, historyEntry, historyParams, historyRouter } from "./support/history";
import { menuItem } from "./support/native-ui";
import { fakeRuntime, Harness, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => require("./support/history").historyRouterModule());
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);

function runtime(overrides: Partial<CueRuntime> = {}): CueRuntime {
  return {
    ...fakeRuntime({}),
    loadHistory: () => Promise.resolve({ entries: HISTORY, page: 1, pageCount: 1 }),
    ...overrides,
  };
}

async function paint(value = runtime()): Promise<void> {
  await render(
    <Harness runtime={value} haptics={spyHaptics()}>
      <HistoryScreen />
    </Harness>,
  );
}

async function removePlay() {
  const item = await menuItem(within(screen.getByTestId("history-list")), "Remove this play");
  if (item === null) throw new Error("the first row's menu has no Remove this play");
  return item;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  historyParams.current = {};
});

afterEach(() => jest.useRealTimers());

test("keeps its root unflattened under the floating bar, so UIKit finds the list first", async () => {
  await paint();

  expect(await screen.findByTestId("screen-history")).toHaveProp("collapsable", false);
});

test("collapses one item per local day, counts plays and removes newest first", async () => {
  const submit = jest.fn<ReturnType<CueRuntime["submit"]>, Parameters<CueRuntime["submit"]>>(() =>
    Promise.resolve("deferred"),
  );
  await paint(runtime({ submit }));
  await screen.findByTestId("history-row-0");
  expect(screen.queryByTestId("history-row-1")).toBeNull();
  expect(screen.getByText("×3", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByTestId("history-day-header-0")).toHaveTextContent(/3 movies$/);
  await fireEvent.press(await removePlay());
  expect(submit.mock.calls[0]?.[0].request.body).toEqual({ ids: [3] });
  expect(screen.getByText("Removed 1 play · 2 remain")).toBeOnTheScreen();
  expect(screen.getByText("×2", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(await removePlay());
  expect(submit.mock.calls[1]?.[0].request.body).toEqual({ ids: [2] });
});

test.each([
  "deferred",
  "failed",
] as const)("Undo awaits its own %s removal outcome", async (outcome) => {
  let settle: (value: SubmitOutcome) => void = () => {};
  const pending = new Promise<SubmitOutcome>((resolve) => {
    settle = resolve;
  });
  const submit = jest
    .fn<ReturnType<CueRuntime["submit"]>, Parameters<CueRuntime["submit"]>>()
    .mockReturnValueOnce(pending)
    .mockResolvedValue("deferred");
  await paint(runtime({ submit }));
  await screen.findByTestId("history-row-0");
  await fireEvent.press(await removePlay());
  await fireEvent.press(screen.getByText("Undo"));
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => settle(outcome));
  expect(submit).toHaveBeenCalledTimes(outcome === "failed" ? 1 : 2);
  if (outcome === "deferred") expect(screen.queryByTestId("snackbar")).toBeNull();
  expect(screen.getByText("×3", { includeHiddenElements: true })).toBeOnTheScreen();
});

test("a failed earlier page stays disarmed until Retry, then paging resumes", async () => {
  const loadHistory = jest
    .fn<ReturnType<CueRuntime["loadHistory"]>, Parameters<CueRuntime["loadHistory"]>>()
    .mockResolvedValueOnce({ entries: HISTORY, page: 1, pageCount: 3 })
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({
      entries: [historyEntry({ historyId: 4, watchedAt: "2026-08-20T20:00:00.000Z" })],
      page: 2,
      pageCount: 3,
    })
    .mockResolvedValueOnce({ entries: [], page: 3, pageCount: 3 });
  await paint(runtime({ loadHistory }));
  await screen.findByTestId("history-row-0");
  await fireEvent(screen.getByTestId("history-list"), "endReached");
  await screen.findByText("Couldn't load earlier history.");
  await fireEvent(screen.getByTestId("history-list"), "endReached");
  expect(loadHistory).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByTestId("history-more"));
  await waitFor(() => expect(screen.queryByText("Couldn't load earlier history.")).toBeNull());
  await fireEvent(screen.getByTestId("history-list"), "endReached");
  await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(4));
});

test("filters loaded titles without hiding the load-more control", async () => {
  await paint(
    runtime({ loadHistory: () => Promise.resolve({ entries: HISTORY, page: 1, pageCount: 2 }) }),
  );
  await screen.findByTestId("history-row-0");
  await fireEvent.changeText(screen.getByLabelText("Filter by title"), "no such title");
  expect(screen.getByText("No titles match.")).toBeOnTheScreen();
  expect(screen.getByTestId("history-more")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Filter by title"), "  WINTER  ");
  expect(screen.getByTestId("history-row-0")).toBeOnTheScreen();
});

test("opens the month jump on the scope History is showing", async () => {
  historyParams.current = { type: "movies", year: "2025", month: "3" };
  await paint();
  await fireEvent.press(screen.getByTestId("history-jump"));
  expect(historyRouter.push).toHaveBeenCalledWith({
    pathname: "/history-jump",
    params: { type: "movies", year: 2025, month: 3 },
  });
});

test("offers recovery from an initial error", async () => {
  const loadHistory = jest
    .fn<ReturnType<CueRuntime["loadHistory"]>, Parameters<CueRuntime["loadHistory"]>>()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ entries: HISTORY, page: 1, pageCount: 1 });
  await paint(runtime({ loadHistory }));
  await screen.findByText("Couldn't load your history");
  await fireEvent.press(screen.getByText("Retry"));
  expect(await screen.findByTestId("history-row-0")).toBeOnTheScreen();
});

test("explains unscoped emptiness", async () => {
  await paint(
    runtime({
      loadHistory: () => Promise.resolve({ entries: [], page: 1, pageCount: 1 }),
    }),
  );
  expect(await screen.findByText("Nothing logged yet.")).toBeOnTheScreen();
});

test("uses the month window and returns to recent without changing medium", async () => {
  historyParams.current = { type: "movies", year: "2020", month: "2" };
  const loadHistory = jest.fn(() => Promise.resolve({ entries: [], page: 1, pageCount: 1 }));
  await paint(runtime({ loadHistory }));
  expect(await screen.findByText("Nothing watched in Feb 2020.")).toBeOnTheScreen();
  // February 2020 in the device's zone; the window arithmetic itself is covered in the core.
  expect(loadHistory).toHaveBeenCalledWith("movies", 1, historyRange(2020, 2));
  await fireEvent.press(screen.getByText("Back to recent"));
  expect(historyRouter.setParams).toHaveBeenCalledWith({ year: "", month: "" });
});

test("opens movie detail in the stack History sits in", async () => {
  await paint();
  const row = await screen.findByTestId("history-row-0");
  const [touch] = within(row).getAllByText(/./, { includeHiddenElements: true });
  await fireEvent.press(touch ?? row);
  expect(historyRouter.push).toHaveBeenCalledWith("/movie/9");
  await fireEvent.press(screen.getByTestId("history-filter-shows"));
  expect(historyRouter.setParams).toHaveBeenCalledWith({ type: "tv" });
});
