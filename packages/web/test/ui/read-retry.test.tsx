/**
 * The read retry policy as the app actually wires it: a transient failure is
 * retried on the server's own schedule before any screen is told, and what a
 * screen is finally told carries the failure kind plus whether anything is still
 * trying. Both halves are what stop a single 429 mid-refetch from painting an
 * outage over data that is on the screen and fine.
 */

import { TraktReadError } from "@cue/core/data/trakt/client";
import { queryStatus } from "@cue/core/hooks/query-freshness";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});

describe("a read that keeps failing", () => {
  it("is retried on the server's Retry-After before the screen hears about it", async () => {
    const queryFn = vi.fn(() =>
      Promise.reject(new TraktReadError({ kind: "rate-limited", retryAfterMs: 7000 }, "library")),
    );
    const seen = mountRead(queryFn);

    // Still trying, so there is nothing for the user to retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(last(seen).retrying).toBe(true);
    expect(last(seen).isError).toBe(false);

    // Not a moment before Trakt said so.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
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
