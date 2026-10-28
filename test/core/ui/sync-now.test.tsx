// @vitest-environment jsdom

import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import { useSyncNow } from "@/core/hooks/useSyncNow";
import { dismissSnack, useSnackbar } from "@/core/stores/snackbar-store";
import { partialRuntime, withRuntime } from "../support/runtime";

const FAILED = "Couldn't reach Trakt. Check your connection.";

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
  const runtime = partialRuntime({
    pendingWrites: () => (pass.flush === undefined ? 0 : 1),
    flushWrites: pass.flush ?? (() => Promise.resolve(0)),
    pollActivities,
  });
  const load = pass.load ?? (() => Promise.resolve({ entries: [] }));
  const { result } = renderHook(
    () => {
      useQuery({ queryKey: queryKeys.library(), queryFn: load, retry: false });
      return useSyncNow();
    },
    { wrapper: withRuntime(runtime, new QueryClient()) },
  );
  await act(async () => {});
  let clean: boolean | undefined;
  await act(async () => {
    clean = await result.current.run();
  });
  return { clean, commit, pollActivities, syncing: result.current.syncing };
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

  it("fetches a read that failed again once Trakt answers, though nothing changed there", async () => {
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ entries: [] });
    const pass = await syncPass({ keys: [], load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(pass.clean).toBe(true);
    expect(snack()).toBeNull();
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
