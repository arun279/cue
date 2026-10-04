import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { AppIdle, resetAppIdleStamp, useAppIdleStamp } from "../../src/ui/AppIdle";
import { HARNESS_IDS } from "../../src/ui/harness-ids";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

beforeEach(() => {
  useSyncActivity.setState({ checked: true });
  resetAppIdleStamp();
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  Reflect.deleteProperty(performance, "rnStartupTiming");
});

function mount(children: ReactNode) {
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function withRuntime(pending: number): ReactElement {
  const runtime = { pendingWrites: () => pending } as unknown as CueRuntime;
  return (
    <RuntimeProvider value={runtime}>
      <AppIdle />
    </RuntimeProvider>
  );
}

function Stamp({ hasData }: { readonly hasData: boolean }): null {
  useAppIdleStamp(hasData);
  return null;
}

function startedAt(startTime: number) {
  Object.defineProperty(performance, "rnStartupTiming", {
    configurable: true,
    value: { startTime },
  });
}

function Reader({ read }: { readonly read: () => Promise<string> }): null {
  useQuery({ queryKey: ["reader"], queryFn: read });
  return null;
}

it("is absent while a read is in flight and present once it settles", async () => {
  let settle: (value: string) => void = () => {};
  const read = () =>
    new Promise<string>((resolve) => {
      settle = resolve;
    });

  await mount(
    <>
      <Reader read={read} />
      <AppIdle />
    </>,
  );
  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();

  await act(async () => settle("Salt Air"));

  await waitFor(() => expect(screen.getByTestId(HARNESS_IDS.appIdle)).toBeOnTheScreen());
});

it("is absent while a write is in flight", async () => {
  await mount(withRuntime(0));
  expect(screen.getByTestId(HARNESS_IDS.appIdle)).toBeOnTheScreen();

  await act(async () => useSyncActivity.getState().begin());
  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();

  await act(async () => useSyncActivity.getState().end());
  expect(screen.getByTestId(HARNESS_IDS.appIdle)).toBeOnTheScreen();
});

it("keeps the readiness marker absent until the session's activities poll has run", async () => {
  useSyncActivity.setState({ checked: false });
  await mount(<AppIdle />);
  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();

  await act(async () => useSyncActivity.getState().setChecked(true));
  expect(screen.getByTestId(HARNESS_IDS.appIdle)).toBeOnTheScreen();
});

it("stamps the first render that has data, not an earlier one with data pending", async () => {
  const now = jest.spyOn(performance, "now").mockReturnValue(725);
  startedAt(100);
  const screenTree = (hasData: boolean) => (
    <>
      <Stamp hasData={hasData} />
      <AppIdle />
    </>
  );
  const { rerender } = await mount(screenTree(false));
  expect(screen.getByTestId(HARNESS_IDS.appIdle)).toBeOnTheScreen();
  expect(screen.queryByTestId(HARNESS_IDS.appIdleTiming)).toBeNull();

  now.mockReturnValue(900);
  await rerender(<QueryClientProvider client={client}>{screenTree(true)}</QueryClientProvider>);
  now.mockReturnValue(2400);
  await rerender(<QueryClientProvider client={client}>{screenTree(false)}</QueryClientProvider>);
  await rerender(<QueryClientProvider client={client}>{screenTree(true)}</QueryClientProvider>);

  expect(screen.getByTestId(HARNESS_IDS.appIdleTiming)).toHaveProp(
    "accessibilityLabel",
    "Returning-user app idle: 800.0 ms",
  );
});

it("keeps the stamp from before the first activities poll lands", async () => {
  useSyncActivity.setState({ checked: false });
  const now = jest.spyOn(performance, "now").mockReturnValue(725);
  startedAt(100);
  await mount(
    <>
      <Stamp hasData />
      <AppIdle />
    </>,
  );
  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();

  now.mockReturnValue(2400);
  await act(async () => useSyncActivity.getState().setChecked(true));

  expect(screen.getByTestId(HARNESS_IDS.appIdleTiming)).toHaveProp(
    "accessibilityLabel",
    "Returning-user app idle: 625.0 ms",
  );
});

it("is absent while a write is only queued, with nothing in flight behind it", async () => {
  await mount(withRuntime(2));

  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();
});

it("exposes returning-user app-idle timing without drawing text", async () => {
  jest.spyOn(performance, "now").mockReturnValue(725);
  startedAt(100);

  await mount(
    <>
      <Stamp hasData />
      <AppIdle />
    </>,
  );

  expect(screen.getByTestId(HARNESS_IDS.appIdleTiming)).toHaveProp(
    "accessibilityLabel",
    "Returning-user app idle: 625.0 ms",
  );
  expect(screen.getByTestId(HARNESS_IDS.appIdleTiming).props["children"]).toBeUndefined();
});

it("names the performance.now fallback", async () => {
  jest.spyOn(performance, "now").mockReturnValue(725);

  await mount(
    <>
      <Stamp hasData />
      <AppIdle />
    </>,
  );

  expect(screen.getByTestId(HARNESS_IDS.appIdleTiming)).toHaveProp(
    "accessibilityLabel",
    "Returning-user app idle: 0.0 ms (performance.now fallback)",
  );
});
