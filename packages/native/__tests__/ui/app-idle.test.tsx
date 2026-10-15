import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { AppIdle } from "../../src/ui/AppIdle";
import { HARNESS_IDS } from "../../src/ui/harness-ids";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

beforeEach(() => {
  useSyncActivity.setState({ checked: true });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
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

it("is absent while a write is only queued, with nothing in flight behind it", async () => {
  await mount(withRuntime(2));

  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();
});

it("keeps readiness after first idle while live idle follows background work", async () => {
  useSyncActivity.setState({ checked: false });
  await mount(<AppIdle />);
  expect(screen.queryByTestId(HARNESS_IDS.appReady)).toBeNull();

  await act(async () => useSyncActivity.getState().setChecked(true));
  expect(screen.getByTestId(HARNESS_IDS.appReady)).toBeOnTheScreen();

  await act(async () => useSyncActivity.getState().begin());
  expect(screen.queryByTestId(HARNESS_IDS.appIdle)).toBeNull();
  expect(screen.getByTestId(HARNESS_IDS.appReady)).toBeOnTheScreen();
  await act(async () => useSyncActivity.getState().end());
});
