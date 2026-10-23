// @vitest-environment jsdom
/**
 * The read retry policy as the app actually wires it: a transient failure is
 * retried on the server's own schedule before any screen is told, and what a
 * screen is finally told carries the failure kind plus whether anything is still
 * trying. Both halves are what stop a single 429 mid-refetch from painting an
 * outage over data that is on the screen and fine.
 */

import {
  type FetchLike,
  TraktClient,
  TraktReadError,
  type TraktResult,
  unwrapRead,
} from "@cue/core/data/trakt/client";
import { DEFAULT_TRAKT_POLICY } from "@cue/core/data/trakt/policy";
import {
  loadUpNextEntries,
  resetReadPause,
  withReadRateRetry,
} from "@cue/core/data/trakt/read-budget";
import { backoffMs } from "@cue/core/domain/write-queue/classify";
import { useReadRetry } from "@cue/core/hooks/useReadRetry";
import { queryStatus, retryingPast } from "@cue/core/queries/freshness";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import {
  onlineManager,
  type QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

type Status = ReturnType<typeof queryStatus>;

function mountRead(queryFn: () => Promise<unknown>): Status[] {
  const seen: Status[] = [];
  function Probe(): null {
    const query = useQuery({ queryKey: ["probe"], queryFn, staleTime: 0 });
    seen.push(queryStatus(query, query.data !== undefined));
    return null;
  }
  mount(
    <QueryClientProvider client={createQueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  return seen;
}

const last = (seen: Status[]): Status => seen[seen.length - 1] as Status;

beforeEach(() => {
  vi.useFakeTimers();
  resetReadPause();
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  resetReadPause();
});

describe("a read that keeps failing", () => {
  it("is retried on the shared backoff ladder before the screen hears about it", async () => {
    const queryFn = vi.fn(() => Promise.reject(new TraktReadError({ kind: "network" }, "library")));
    const seen = mountRead(queryFn);

    // Still trying, so there is nothing for the user to retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(last(seen).retrying).toBe(true);
    expect(last(seen).isError).toBe(false);

    // The same ladder the write queue backs off on.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(backoffMs(0) - 100);
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(backoffMs(1) - 1);
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it("settles on a failure the screen can name, and stops calling itself retrying", async () => {
    const queryFn = vi.fn(() => Promise.reject(new TraktReadError({ kind: "network" }, "library")));
    const seen = mountRead(queryFn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(last(seen).isError).toBe(true);
    expect(last(seen).retrying).toBe(false);
    expect(last(seen).failure).toEqual({ kind: "network" });
  });

  it("counts an already-failed read that is trying again as retrying", async () => {
    // TanStack keeps `error` set across every later fetch once the query has
    // data, so reading only `isError` reports "not retrying" for the whole of the
    // next ladder and leaves a Retry button up while the app is already retrying.
    let phase: "ok" | "fail" | "hang" = "ok";
    const queryFn = vi.fn(() => {
      if (phase === "ok") return Promise.resolve(1);
      if (phase === "hang") return new Promise<number>(() => {});
      return Promise.reject(new TraktReadError({ kind: "network" }, "library"));
    });
    const seen: Status[] = [];
    let refetch = (): void => {};
    function Probe(): null {
      const query = useQuery({ queryKey: ["warm"], queryFn, staleTime: 0 });
      refetch = () => void query.refetch();
      seen.push(queryStatus(query, query.data !== undefined));
      return null;
    }
    mount(
      <QueryClientProvider client={createQueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last(seen).hasData).toBe(true);

    phase = "fail";
    await act(async () => {
      refetch();
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(last(seen).isError).toBe(true);
    expect(last(seen).retrying).toBe(false);

    phase = "hang";
    await act(async () => {
      refetch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last(seen).isError).toBe(true);
    expect(last(seen).retrying).toBe(true);
  });

  it("does not retry a failure that will never heal", async () => {
    const queryFn = vi.fn(() =>
      Promise.reject(new TraktReadError({ kind: "unauthorized" }, "library")),
    );
    const seen = mountRead(queryFn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(last(seen).failure).toEqual({ kind: "unauthorized" });
    expect(last(seen).retrying).toBe(false);
  });
});

describe("a read while the device is offline", () => {
  const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("is not sent until the device reconnects, and the screen stays loading meanwhile", async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn(() => Promise.resolve(1));
    const seen = mountRead(queryFn);
    await elapse(60_000);
    expect(queryFn).not.toHaveBeenCalled();
    expect(last(seen).isLoading).toBe(true);

    act(() => onlineManager.setOnline(true));
    await elapse(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("holds its remaining retries until the device reconnects", async () => {
    const queryFn = vi.fn(() => Promise.reject(new TraktReadError({ kind: "network" }, "library")));
    const seen = mountRead(queryFn);
    await elapse(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(false));
    await elapse(60_000);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(last(seen).isError).toBe(false);

    act(() => onlineManager.setOnline(true));
    await elapse(10_000);
    expect(queryFn).toHaveBeenCalledTimes(3);
  });
});

describe("a sustained rate limit", () => {
  it("costs one bounded ladder of requests to the endpoint, not two stacked", async () => {
    // The pool retries a 429 on Trakt's own schedule; the query layer must not
    // retry the same failure on top of it, or one refetch of an aggregate read
    // costs three times the requests into the window that asked for fewer.
    let requests = 0;
    const queryFn = () =>
      withReadRateRetry(() => {
        requests += 1;
        return Promise.resolve({
          ok: false,
          error: { kind: "rate-limited", retryAfterMs: 1000 },
        } as TraktResult<never>);
      }).then((read) => unwrapRead(read, "watched shows"));

    const seen = mountRead(queryFn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(requests).toBe(DEFAULT_TRAKT_POLICY.rateLimit.retries + 1);
    expect(last(seen).failure).toEqual({ kind: "rate-limited", retryAfterMs: 1000 });
    expect(last(seen).retrying).toBe(false);
  });
});

describe("a load that retries its own reads", () => {
  /** A Trakt whose hidden list fails once with a 503 and answers every other read empty. */
  function flakyHiddenList(): TraktClient {
    let hiddenReads = 0;
    const fetch: FetchLike = async (input) => {
      if (input.includes("/users/hidden/progress_watched") && ++hiddenReads === 1)
        return new Response("{}", { status: 503 });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    return new TraktClient({ clientId: "cid", fetch });
  }

  function mountLoad(client: TraktClient): { seen: Status[]; queryClient: QueryClient } {
    const queryClient = createQueryClient();
    const seen: Status[] = [];
    function Probe(): null {
      const failure = useReadRetry();
      const query = useQuery({
        queryKey: ["load"],
        queryFn: () => loadUpNextEntries(client),
        retry: false,
      });
      seen.push(retryingPast(queryStatus(query, query.data !== undefined), failure));
      return null;
    }
    mount(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
    return { seen, queryClient };
  }

  it("tells the screen it is still trying, and why, until the failed read lands", async () => {
    const { seen } = mountLoad(flakyHiddenList());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last(seen)).toMatchObject({
      isLoading: true,
      retrying: true,
      failure: { kind: "server", status: 503 },
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(last(seen)).toMatchObject({ hasData: true, retrying: false, failure: null });
  });

  it("stops saying it is trying once the screen's own fetch is cancelled", async () => {
    const { seen, queryClient } = mountLoad(flakyHiddenList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last(seen).retrying).toBe(true);

    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["load"] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last(seen)).toMatchObject({ isFetching: false, retrying: false });
  });
});
