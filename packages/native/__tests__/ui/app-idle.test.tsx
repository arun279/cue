import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { AppIdle } from "../../src/ui/AppIdle";
import { TEST_IDS } from "../../src/ui/test-ids";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

afterEach(() => client.clear());

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
  expect(screen.queryByTestId(TEST_IDS.appIdle)).toBeNull();

  await act(async () => settle("Salt Air"));

  await waitFor(() => expect(screen.getByTestId(TEST_IDS.appIdle)).toBeOnTheScreen());
});

it("is absent while a write is in flight", async () => {
  await mount(withRuntime(0));
  expect(screen.getByTestId(TEST_IDS.appIdle)).toBeOnTheScreen();

  await act(async () => useSyncActivity.getState().begin());
  expect(screen.queryByTestId(TEST_IDS.appIdle)).toBeNull();

  await act(async () => useSyncActivity.getState().end());
  expect(screen.getByTestId(TEST_IDS.appIdle)).toBeOnTheScreen();
});

it("is absent while a write is only queued, with nothing in flight behind it", async () => {
  await mount(withRuntime(2));

  expect(screen.queryByTestId(TEST_IDS.appIdle)).toBeNull();
});
