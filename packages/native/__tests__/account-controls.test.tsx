import { queryKeys } from "@cue/core/data/query-keys";
import { act, screen, userEvent, within } from "@testing-library/react-native";
import "./support/screen-mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataSection, syncedPhrase } from "../src/screens/account/DataSection";
import * as harness from "../src/ui/harness";
import { relativeTimeNow } from "../src/ui/harness.store";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture } from "./support/account";
import { held } from "./support/up-next";

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  [0, "Not synced yet"],
  [1_000, "Last synced just now"],
  [120_000, "Last synced 2 min ago"],
  [18_000_000, "Last synced 5 hr ago"],
  [86_400_000, "Last synced 1 day ago"],
  [172_800_000, "Last synced 2 days ago"],
])("formats sync age %s", (age, phrase) => {
  const now = 180_000_000;
  expect(syncedPhrase(age === 0 ? 0 : now - age, now)).toBe(phrase);
});

it("ticks every 30 seconds and excludes editorial reads from account freshness", async () => {
  jest.spyOn(harness, "relativeTimeNow").mockImplementation(relativeTimeNow);
  jest.useFakeTimers();
  const client = new QueryClient();
  const fixture = accountFixture({ pendingWrites: () => 3 });
  await fixture.paint(
    <QueryClientProvider client={client}>
      <DataSection />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Not synced yet · 3 pending")).toBeVisible();
  await act(() => client.setQueryData(queryKeys.browse(), {}));
  expect(screen.getByText("Not synced yet · 3 pending")).toBeVisible();
  await act(() => client.setQueryData(queryKeys.library(), {}));
  expect(screen.getByText("Last synced just now · 3 pending")).toBeVisible();
  await act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByText("Last synced 1 min ago · 3 pending")).toBeVisible();
  await act(() => client.clear());
});

it("keeps harness sync freshness unchanged after delays, refetches and remounts", async () => {
  jest.useFakeTimers();
  const client = new QueryClient();
  const fixture = accountFixture();
  const paint = () =>
    fixture.paint(
      <QueryClientProvider client={client}>
        <DataSection />
      </QueryClientProvider>,
    );
  await act(() => client.setQueryData(queryKeys.library(), {}));
  const view = await paint();
  expect(screen.getByText("Last synced just now · 0 pending")).toBeVisible();
  await act(() => jest.advanceTimersByTime(120_000));
  expect(screen.getByText("Last synced just now · 0 pending")).toBeVisible();
  await act(() => client.setQueryData(queryKeys.library(), {}));
  await view.unmount();
  await act(() => jest.advanceTimersByTime(120_000));
  await paint();
  expect(screen.getByText("Last synced just now · 0 pending")).toBeVisible();
  await act(() => client.clear());
});

it("shows the sync as busy until the shared pass settles, then says it just synced", async () => {
  const flush = held<number>();
  const fixture = accountFixture({
    flushWrites: flush.call,
    pollActivities: async () => ({ keys: [], commit: async () => {} }),
  });
  await fixture.paint(<DataSection />);
  expect(screen.getByText("Not synced yet · 0 pending")).toBeVisible();

  await userEvent.press(screen.getByRole("button", { name: "Sync now" }));

  const busy = screen.getByRole("button", { name: "Syncing…" });
  expect(busy).toHaveProp("accessibilityState", { disabled: true, busy: true });
  expect(within(busy).getByTestId(`${TEST_IDS.settingsSync}-busy`)).toBeOnTheScreen();
  await act(() => flush.release(0));
  expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  expect(screen.getByText("Last synced just now · 0 pending")).toBeVisible();
  expect(flush.call).toHaveBeenCalledTimes(1);
});
