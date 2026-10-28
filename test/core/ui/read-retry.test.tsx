// @vitest-environment jsdom
/**
 * The read retry policy as the app actually wires it: a transient failure is
 * retried on the server's own schedule before any screen is told, and what a
 * screen is finally told carries the failure kind plus whether anything is still
 * trying. Both halves are what stop a single 429 mid-refetch from painting an
 * outage over data that is on the screen and fine.
 */

import { onlineManager, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraktClient, type TraktResult, unwrapRead } from "@/core/data/trakt/client";
import { DEFAULT_TRAKT_POLICY } from "@/core/data/trakt/policy";
import {
  loadUpNextEntries,
  readRetryFailure,
  resetReadPause,
  subscribeReadRetry,
  withReadRateRetry,
} from "@/core/data/trakt/read-budget";
import { TraktReadError } from "@/core/domain/read-failure";
import { backoffMs } from "@/core/domain/write-queue/classify";
import { useReadRetry } from "@/core/hooks/useReadRetry";
import { queryStatus, retryingPast } from "@/core/queries/freshness";
import { createQueryClient } from "@/core/runtime/query-cache";
import { RuntimeProvider } from "@/core/runtime/runtime";
import { partialRuntime } from "../support/runtime";
import { emptyAccount } from "../trakt-fake/account.ts";
import { createTraktFake } from "../trakt-fake/fake.ts";

type Status = ReturnType<typeof queryStatus>;

const runtime = partialRuntime({ readRetryFailure, subscribeReadRetry });

function readStatus<T>(useRead: () => T, client = createQueryClient()): { readonly current: T } {
  return renderHook(useRead, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <RuntimeProvider value={runtime}>{children}</RuntimeProvider>
      </QueryClientProvider>
    ),
  }).result;
}

function mountRead(queryFn: () => Promise<unknown>): { readonly current: Status } {
  return readStatus(() => {
    const query = useQuery({ queryKey: ["probe"], queryFn, staleTime: 0 });
    return queryStatus(query, query.data !== undefined);
  });
}

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
    expect(seen.current.retrying).toBe(true);
    expect(seen.current.isError).toBe(false);

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
    expect(seen.current.isError).toBe(true);
    expect(seen.current.retrying).toBe(false);
    expect(seen.current.failure).toEqual({ kind: "network" });
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
    let refetch = (): void => {};
    const seen = readStatus(() => {
      const query = useQuery({ queryKey: ["warm"], queryFn, staleTime: 0 });
      refetch = () => void query.refetch();
      return queryStatus(query, query.data !== undefined);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.current.hasData).toBe(true);

    phase = "fail";
    await act(async () => {
      refetch();
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(seen.current.isError).toBe(true);
    expect(seen.current.retrying).toBe(false);

    phase = "hang";
    await act(async () => {
      refetch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.current.isError).toBe(true);
    expect(seen.current.retrying).toBe(true);
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
    expect(seen.current.failure).toEqual({ kind: "unauthorized" });
    expect(seen.current.retrying).toBe(false);
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
    expect(seen.current.isLoading).toBe(true);

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
    expect(seen.current.isError).toBe(false);

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
    expect(seen.current.failure).toEqual({ kind: "rate-limited", retryAfterMs: 1000 });
    expect(seen.current.retrying).toBe(false);
  });
});

describe("a load that retries its own reads", () => {
  /** An empty account whose hidden list fails once with a 503. */
  function flakyHiddenList(): TraktClient {
    const fake = createTraktFake({ account: () => emptyAccount() });
    fake.fail({ path: /^\/users\/hidden\/progress_watched$/ }, 503);
    return new TraktClient({
      clientId: "cid",
      getToken: () => fake.session().access_token,
      fetch: fake.fetch,
    });
  }

  function mountLoad(client: TraktClient) {
    const queryClient = createQueryClient();
    const seen = readStatus(() => {
      const failure = useReadRetry();
      const query = useQuery({
        queryKey: ["load"],
        queryFn: () => loadUpNextEntries(client),
        retry: false,
      });
      return retryingPast(queryStatus(query, query.data !== undefined), failure);
    }, queryClient);
    return { seen, queryClient };
  }

  it("tells the screen it is still trying, and why, until the failed read lands", async () => {
    const { seen } = mountLoad(flakyHiddenList());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.current).toMatchObject({
      isLoading: true,
      retrying: true,
      failure: { kind: "server", status: 503 },
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(seen.current).toMatchObject({ hasData: true, retrying: false, failure: null });
  });

  it("stops saying it is trying once the screen's own fetch is cancelled", async () => {
    const { seen, queryClient } = mountLoad(flakyHiddenList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.current.retrying).toBe(true);

    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["load"] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.current).toMatchObject({ isFetching: false, retrying: false });
  });
});
