import { queryKeys } from "@data/query-keys";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { dismissSnack, useSnackbar } from "@ui/components/snackbar-store";
import { type CueRuntime, RuntimeProvider } from "@ui/runtime/runtime";
import { useSyncStatus } from "@ui/screens/settings/useSyncStatus";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

const NOW = 1_750_000_000_000;
const HOUR = 60 * 60_000;

type SyncView = ReturnType<typeof useSyncStatus>;

function Probe({ slot }: { readonly slot: SyncView[] }): null {
  slot[0] = useSyncStatus();
  return null;
}

function runtimeWith(
  reconcile: CueRuntime["pollActivities"] extends () => Promise<infer R> ? R : never,
) {
  return {
    pendingWrites: () => 0,
    flushWrites: () => Promise.resolve(0),
    pollActivities: () => Promise.resolve(reconcile),
  } as unknown as CueRuntime;
}

async function mountStatus(runtime: CueRuntime, client: QueryClient): Promise<SyncView[]> {
  const slot: SyncView[] = [];
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return slot;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  dismissSnack();
});

afterEach(() => {
  vi.useRealTimers();
  dismissSnack();
});

describe("useSyncStatus manual reconcile", () => {
  it("advances the status line after a clean reconcile", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.userStats(), {}, { updatedAt: NOW - HOUR });
    const slot = await mountStatus(runtimeWith({ keys: [], commit }), client);

    await act(async () => slot[0]?.syncNow());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(slot[0]?.line).toBe("Last synced just now · 0 pending");
    expect(useSnackbar.getState().snack).toBeNull();
  });

  it("keeps the prior status and shows an error when an invalidated refetch fails", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.userStats(), {}, { updatedAt: NOW - HOUR });
    client.setQueryData(queryKeys.library(), {}, { updatedAt: NOW - HOUR });
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.library(),
      queryFn: () => Promise.reject(new Error("offline")),
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    const slot = await mountStatus(runtimeWith({ keys: [queryKeys.library()], commit }), client);
    expect(slot[0]?.line).toBe("Last synced 1 hr ago · 0 pending");

    await act(async () => slot[0]?.syncNow());

    expect(commit).not.toHaveBeenCalled();
    expect(slot[0]?.line).toBe("Last synced 1 hr ago · 0 pending");
    expect(useSnackbar.getState().snack?.message).toBe(
      "Couldn't reach Trakt. Check your connection.",
    );
    unsubscribe();
  });
});
