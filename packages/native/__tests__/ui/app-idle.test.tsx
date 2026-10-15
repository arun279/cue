import { buildMarkMovieOp } from "@cue/core/domain/write-queue/ops";
import type { SubmitOutcome } from "@cue/core/runtime/runtime";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import {
  AppIdle,
  createAcknowledgments,
  trackSync,
  useOptimisticWrite,
} from "../../src/ui/AppIdle";
import { HARNESS_IDS } from "../../src/ui/harness-ids";
import { fakeRuntime } from "../support/up-next";

beforeEach(() => {
  jest.useFakeTimers();
  useSyncActivity.setState({ checked: false, pending: 0 });
});
afterEach(() => jest.useRealTimers());

it("retains readiness through later work, but waits for startup reads and the activities poll", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const read = Promise.withResolvers<string>();
  const request = client.fetchQuery({ queryKey: ["startup"], queryFn: () => read.promise });
  await render(
    <QueryClientProvider client={client}>
      <AppIdle />
    </QueryClientProvider>,
  );
  expect(screen.queryByTestId(HARNESS_IDS.appReady)).toBeNull();
  await act(async () => useSyncActivity.getState().setChecked(true));
  expect(screen.queryByTestId(HARNESS_IDS.appReady)).toBeNull();
  await act(async () => {
    read.resolve("ready");
    await request;
  });
  expect(screen.getByTestId(HARNESS_IDS.appReady)).toBeOnTheScreen();
  await act(async () => useSyncActivity.getState().begin());
  expect(screen.getByTestId(HARNESS_IDS.appReady)).toBeOnTheScreen();
  await act(async () => useSyncActivity.getState().end());
  await act(async () => client.clear());
});

it("retains exact receipts when later operations start or finish out of order", async () => {
  const acknowledgments = createAcknowledgments();
  const first = Promise.withResolvers<SubmitOutcome>();
  const second = Promise.withResolvers<SubmitOutcome>();
  const notify = jest.fn();
  const unsubscribe = acknowledgments.subscribe(notify);
  const one = acknowledgments.run("write", () => first.promise);
  const two = acknowledgments.run("write", () => second.promise);
  expect(acknowledgments.getSnapshot()).toEqual({ write: 2, sync: 0, completed: ";" });
  second.resolve("done");
  await two;
  expect(acknowledgments.getSnapshot().completed).toBe("; write 2 done;");
  jest.advanceTimersByTime(60_000);
  expect(acknowledgments.getSnapshot().completed).toBe("; write 2 done;");
  first.resolve("done");
  await one;
  const receipt = acknowledgments.getSnapshot().completed;
  const later = Promise.withResolvers<SubmitOutcome>();
  const three = acknowledgments.run("write", () => later.promise);
  expect(acknowledgments.getSnapshot().completed).toBe(receipt);
  later.resolve("failed");
  await three;
  expect(acknowledgments.getSnapshot().completed).toBe(
    "; write 2 done; write 1 done; write 3 failed;",
  );
  unsubscribe();
  expect(notify).toHaveBeenCalledTimes(6);
});

it.each(["failed", "deferred"] as const)("does not acknowledge %s as done", async (outcome) => {
  const acknowledgments = createAcknowledgments();
  await acknowledgments.run("write", async () => outcome);
  expect(acknowledgments.getSnapshot().completed).toBe(`; write 1 ${outcome};`);
});

it("records a rejected operation as failed and preserves its rejection", async () => {
  const acknowledgments = createAcknowledgments();
  const error = new Error("offline");
  await expect(
    acknowledgments.run("sync", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(acknowledgments.getSnapshot().completed).toBe("; sync 1 failed;");
});

it("acknowledges a write only after submission and its scheduled reconciliation finish", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const submission = Promise.withResolvers<SubmitOutcome>();
  const runtime = { ...fakeRuntime({}), submit: jest.fn(() => submission.promise) };
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        {children}
        <AppIdle />
      </RuntimeProvider>
    </QueryClientProvider>
  );
  const { result } = await renderHook(useOptimisticWrite, { wrapper });
  const baseline = screen.getByTestId(HARNESS_IDS.operationStarted).props["accessibilityLabel"];
  const id = Number(baseline.match(/write ([0-9]+)/)[1]) + 1;
  const receipt = `write ${id} done;`;
  const op = buildMarkMovieOp({
    opId: "one",
    ids: { trakt: 1 },
    watchedAt: "2026-01-01T00:00:00Z",
  });
  let done: Promise<SubmitOutcome> | undefined;
  await act(async () => {
    done = result.current([op], {
      rollback: jest.fn(),
      revalidate: () => {
        void client.fetchQuery({
          queryKey: ["reconcile"],
          queryFn: () => new Promise((resolve) => setTimeout(() => resolve("updated"), 1000)),
        });
      },
    });
  });
  expect(runtime.submit).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).not.toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => submission.resolve("done"));
  await act(async () => jest.advanceTimersByTime(999));
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).not.toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => {
    jest.advanceTimersByTime(1);
    await done;
  });
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(receipt),
  );
  const background = Promise.withResolvers<string>();
  let backgroundRequest: Promise<string> | undefined;
  await act(async () => {
    backgroundRequest = client.fetchQuery({
      queryKey: ["background"],
      queryFn: () => background.promise,
    });
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => {
    background.resolve("updated");
    await backgroundRequest;
    client.clear();
  });
});

it("keeps the manual sync receipt visible after another sync starts", async () => {
  const client = new QueryClient();
  await render(
    <QueryClientProvider client={client}>
      <AppIdle />
    </QueryClientProvider>,
  );
  const first = Promise.withResolvers<boolean>();
  let done: Promise<boolean> | undefined;
  await act(async () => {
    done = trackSync(() => first.promise);
  });
  const started = screen.getByTestId(HARNESS_IDS.operationStarted).props["accessibilityLabel"];
  const receipt = `sync ${started.match(/sync ([0-9]+)/)[1]} done;`;
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).not.toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => {
    first.resolve(true);
    await done;
  });
  const next = Promise.withResolvers<boolean>();
  await act(async () => {
    done = trackSync(() => next.promise);
  });
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => {
    next.resolve(false);
    await done;
  });
  await act(async () => client.clear());
});
