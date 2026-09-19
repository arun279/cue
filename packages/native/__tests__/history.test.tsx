import type { CueRuntime, SubmitOutcome } from "@cue/core/runtime/runtime";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { HistoryScreen } from "../src/screens/history/HistoryScreen";
import { MONTHS } from "../src/screens/history/model";
import { HISTORY, historyEntry, historyParams, historyRouter } from "./support/history";
import { fakeRuntime, Harness, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => require("./support/history").historyRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
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

beforeEach(() => {
  jest.clearAllMocks();
  historyParams.current = {};
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
  await fireEvent.press(screen.getByTestId("history-row-0-check"));
  expect(submit.mock.calls[0]?.[0].request.body).toEqual({ ids: [3] });
  expect(screen.getByText("Removed 1 play · 2 remain")).toBeOnTheScreen();
  expect(screen.getByText("×2", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId("history-row-0-check"));
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
  await fireEvent.press(await screen.findByTestId("history-row-0-check"));
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

test("month jump shows both grids together and leaves the medium alone", async () => {
  historyParams.current = { type: "movies", year: "2025", month: "3" };
  await paint();
  await fireEvent.press(screen.getByTestId("history-jump"));
  expect(screen.getByTestId("history-jump-month-3")).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId("history-jump-year-2024"));
  await fireEvent.press(screen.getByTestId("history-jump-month-8"));
  expect(historyRouter.setParams).toHaveBeenCalledWith({ year: "2024", month: "8" });
  expect(screen.queryByTestId("history-jump-sheet")).toBeNull();
});

test("offers every month as a named button", async () => {
  historyParams.current = { year: "2025" };
  await paint();
  await fireEvent.press(screen.getByTestId("history-jump"));
  for (const month of MONTHS) expect(screen.getByRole("button", { name: month })).toBeOnTheScreen();
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
  expect(loadHistory).toHaveBeenCalledWith("movies", 1, {
    startAt: "2020-02-01T00:00:00.000Z",
    endAt: "2020-02-29T23:59:59.999Z",
  });
  await fireEvent.press(screen.getByText("Back to recent"));
  expect(historyRouter.setParams).toHaveBeenCalledWith({ year: "", month: "" });
});

test("opens movie detail above the account presentation", async () => {
  await paint();
  await fireEvent.press(await screen.findByTestId("history-row-0"));
  expect(historyRouter.push).toHaveBeenCalledWith("/(account)/movie/9");
  await fireEvent.press(screen.getByTestId("history-filter-shows"));
  expect(historyRouter.setParams).toHaveBeenCalledWith({ type: "tv" });
});
