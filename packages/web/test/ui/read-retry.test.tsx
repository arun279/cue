/**
 * The read retry policy as the app actually wires it: a transient failure is
 * retried on the server's own schedule before any screen is told, and what a
 * screen is finally told carries the failure kind plus whether anything is still
 * trying. Both halves are what stop a single 429 mid-refetch from painting an
 * outage over data that is on the screen and fine.
 */

import { TraktReadError, type TraktResult, unwrapRead } from "@cue/core/data/trakt/client";
import {
  MAX_READ_RATE_RETRIES,
  resetReadPause,
  withReadRateRetry,
} from "@cue/core/data/trakt/read-budget";
import { queryStatus } from "@cue/core/hooks/query-freshness";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
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

    // The same ladder the write queue backs off on: 1s, then 2s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
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

    expect(requests).toBe(MAX_READ_RATE_RETRIES + 1);
    expect(last(seen).failure).toEqual({ kind: "rate-limited", retryAfterMs: 1000 });
    expect(last(seen).retrying).toBe(false);
  });
});
