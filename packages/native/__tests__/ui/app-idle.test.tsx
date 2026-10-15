import { buildMarkMovieOp } from "@cue/core/domain/write-queue/ops";
import { useOptimisticWrite } from "@cue/core/hooks/useOptimisticWrite";
import type { CueRuntime, SubmitOutcome } from "@cue/core/runtime/runtime";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppIdle, createAcknowledgments, trackSync } from "../../src/ui/AppIdle";
import { HARNESS_IDS } from "../../src/ui/harness-ids";
import { fakeRuntime } from "../support/up-next";

beforeEach(() => {
  jest.useFakeTimers();
  useSyncActivity.setState({ checked: false, pending: 0 });
});
afterEach(() => jest.useRealTimers());

function mountWrite(submit: CueRuntime["submit"], client = new QueryClient()) {
  const runtime = fakeRuntime({ submit });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        {children}
        <AppIdle />
      </RuntimeProvider>
    </QueryClientProvider>
  );
  return renderHook(useOptimisticWrite, { wrapper });
}

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
  const first = Promise.withResolvers<SubmitOutcome>();
  const second = Promise.withResolvers<SubmitOutcome>();
  const later = Promise.withResolvers<SubmitOutcome>();
  const { result } = await mountWrite(
    jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(later.promise),
  );
  const { startedWrites: start, completedWrites: completed } = useSyncActivity.getState();
  const op = buildMarkMovieOp({
    opId: "one",
    ids: { trakt: 1 },
    watchedAt: "2026-01-01T00:00:00Z",
  });
  const effects = { rollback: jest.fn(), revalidate: jest.fn() };
  let one: Promise<SubmitOutcome> | undefined;
  let two: Promise<SubmitOutcome> | undefined;
  let three: Promise<SubmitOutcome> | undefined;
  await act(async () => {
    one = result.current([op], effects);
    two = result.current([{ ...op, id: "two" }], effects);
  });
  await act(async () => {
    second.resolve("done");
    await two;
  });
  expect(useSyncActivity.getState().completedWrites).toBe(completed + 1);
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(`; write ${start + 2} done;`),
  );
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).not.toHaveAccessibleName(
    new RegExp(`; write ${start + 1} done;`),
  );
  await act(async () => {
    first.resolve("done");
    await one;
  });
  const receipt = screen.getByTestId(HARNESS_IDS.operationCompleted).props["accessibilityLabel"];
  await act(async () => {
    three = result.current([{ ...op, id: "three" }], effects);
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(receipt);
  await act(async () => {
    later.resolve("failed");
    await three;
  });
  expect(useSyncActivity.getState().completedWrites).toBe(completed + 3);
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(
    new RegExp(`; write ${start + 2} done; write ${start + 1} done; write ${start + 3} failed;`),
  );
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
  const submit = jest.fn(() => submission.promise);
  const { result } = await mountWrite(submit, client);
  const baseline = screen.getByTestId(HARNESS_IDS.operationStarted).props["accessibilityLabel"];
  const id = Number(baseline.match(/write ([0-9]+)/)[1]) + 1;
  const completed = useSyncActivity.getState().completedWrites;
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
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).not.toHaveAccessibleName(
    new RegExp(receipt),
  );
  await act(async () => submission.resolve("done"));
  expect(screen.getByTestId(HARNESS_IDS.operationStarted)).toHaveAccessibleName(
    new RegExp(`completed writes ${completed + 1}$`),
  );
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

it.each([
  "done",
  "failed",
  "deferred",
  "rejected",
] as const)("counts a %s write once and keeps its receipt across later work", async (outcome) => {
  const client = new QueryClient();
  const submission = Promise.withResolvers<SubmitOutcome>();
  const { result, rerender } = await mountWrite(() => submission.promise, client);
  const { startedWrites, completedWrites } = useSyncActivity.getState();
  const op = buildMarkMovieOp({
    opId: "counted",
    ids: { trakt: 1 },
    watchedAt: "2026-01-01T00:00:00Z",
  });
  const error = new Error("offline");
  let settled: Promise<SubmitOutcome | Error> | undefined;
  await act(async () => {
    settled = result
      .current([op, { ...op, id: "second" }], {
        rollback: jest.fn(),
        revalidate: jest.fn(),
      })
      .catch((reason: Error) => reason);
  });
  expect(useSyncActivity.getState().completedWrites).toBe(completedWrites);
  expect(useSyncActivity.getState().startedWrites).toBe(startedWrites + 1);
  await act(async () => {
    if (outcome === "rejected") submission.reject(error);
    else submission.resolve(outcome);
    expect(await settled).toBe(outcome === "rejected" ? error : outcome);
  });
  expect(useSyncActivity.getState().completedWrites).toBe(completedWrites + 1);
  const receipt = new RegExp(
    `; write ${startedWrites + 1} ${outcome === "rejected" ? "failed" : outcome};`,
  );
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(receipt);
  expect(screen.getByTestId(HARNESS_IDS.operationStarted)).toHaveAccessibleName(
    new RegExp(`completed writes ${completedWrites + 1}$`),
  );
  await rerender({});
  await act(async () => {
    useSyncActivity.getState().begin();
    useSyncActivity.getState().end();
    jest.advanceTimersByTime(60_000);
  });
  expect(useSyncActivity.getState().completedWrites).toBe(completedWrites + 1);
  expect(screen.getByTestId(HARNESS_IDS.operationCompleted)).toHaveAccessibleName(receipt);
  await act(async () => client.clear());
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
