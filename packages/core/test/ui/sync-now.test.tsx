// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

type SyncNow = ReturnType<typeof useSyncNow>;

const FAILED = "Couldn't reach Trakt. Check your connection.";

function Probe({
  slot,
  load,
}: {
  readonly slot: SyncNow[];
  readonly load: () => Promise<unknown>;
}) {
  useQuery({ queryKey: queryKeys.library(), queryFn: load, retry: false });
  slot[0] = useSyncNow();
  return null;
}

interface Pass {
  readonly flush?: () => Promise<number>;
  readonly keys?: readonly (readonly unknown[])[];
  readonly polled?: boolean;
  readonly load?: () => Promise<unknown>;
}

async function syncPass(pass: Pass = {}) {
  const commit = vi.fn(() => Promise.resolve());
  const pollActivities = vi.fn(() =>
    Promise.resolve(pass.polled === false ? null : { keys: pass.keys ?? [], commit }),
  );
  const runtime = {
    flushWrites: pass.flush ?? (() => Promise.resolve(0)),
    pollActivities,
  } as unknown as CueRuntime;
  const slot: SyncNow[] = [];
  await mountAsync(
    <QueryClientProvider client={new QueryClient()}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} load={pass.load ?? (() => Promise.resolve({ entries: [] }))} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  let clean: boolean | undefined;
  await act(async () => {
    clean = await slot[0]?.run();
  });
  return { clean, commit, pollActivities, syncing: slot[0]?.syncing };
}

const snack = () => useSnackbar.getState().snack?.message ?? null;

beforeEach(dismissSnack);

describe("useSyncNow", () => {
  it("refreshes the reads that changed, then advances the baseline", async () => {
    const load = vi.fn(() => Promise.resolve({ entries: [] }));
    const pass = await syncPass({ keys: [queryKeys.library()], load });
    expect(pass.clean).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(pass.commit).toHaveBeenCalledOnce();
    expect(pass.syncing).toBe(false);
    expect(snack()).toBeNull();
  });

  it("keeps the baseline and says so when a changed read fails to refresh", async () => {
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ entries: [] })
      .mockRejectedValue(new Error("offline"));
    const pass = await syncPass({ keys: [queryKeys.library()], load });
    expect(pass.clean).toBe(false);
    expect(pass.commit).not.toHaveBeenCalled();
    expect(snack()).toBe(FAILED);
  });

  it("does not reconcile over writes that have not landed", async () => {
    const pass = await syncPass({ flush: () => Promise.resolve(2) });
    expect(pass.clean).toBe(false);
    expect(pass.pollActivities).not.toHaveBeenCalled();
    expect(snack()).toBe(FAILED);
  });

  it("fails once, the same way, when the poll or the flush itself fails", async () => {
    expect((await syncPass({ polled: false })).clean).toBe(false);
    expect(snack()).toBe(FAILED);
    dismissSnack();
    const thrown = await syncPass({ flush: () => Promise.reject(new Error("storage")) });
    expect(thrown).toMatchObject({ clean: false, syncing: false });
    expect(snack()).toBe(FAILED);
  });
});
