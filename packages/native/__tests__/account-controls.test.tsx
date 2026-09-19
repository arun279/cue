import { queryKeys } from "@cue/core/data/query-keys";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import "./support/screen-mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataSection, syncedPhrase } from "../src/screens/account/DataSection";
import { accountFixture } from "./support/account";

jest.mock("expo", () => {
  const expo = jest.requireActual("expo");
  return {
    ...expo,
    requireNativeModule: (name: string) =>
      name === "ExpoUI" ? { getMaterialColors: () => ({}) } : expo.requireNativeModule(name),
  };
});

it("records the platform segmented control's missing accessible choices", async () => {
  await render(<SegmentedControl values={["System", "Dark", "Light"]} selectedIndex={0} />);
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
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
  jest.useRealTimers();
});

it("disables manual sync until the shared pass settles", async () => {
  let finish: (remaining: number) => void = () => {};
  const flushWrites = jest.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const fixture = accountFixture({ flushWrites });
  await fixture.paint(<DataSection />);
  await userEvent.press(screen.getByRole("button", { name: "Sync now" }));
  expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  await act(() => finish(0));
  expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  expect(flushWrites).toHaveBeenCalledTimes(1);
});
