import { type SubmitOutcome, useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";
import { listenForCommands } from "./perf-channel";

type Operation = "write" | "sync";

export function createAcknowledgments() {
  let snapshot = { write: 0, sync: 0, completed: ";" };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const complete = (kind: Operation, id: number, outcome: SubmitOutcome): void => {
    publish({ ...snapshot, completed: `${snapshot.completed} ${kind} ${id} ${outcome};` });
  };
  return {
    complete,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(kind: Operation, run: () => Promise<SubmitOutcome>): Promise<SubmitOutcome> {
      const id = snapshot[kind] + 1;
      publish({ ...snapshot, [kind]: id });
      let outcome: SubmitOutcome = "failed";
      try {
        outcome = await run();
        return outcome;
      } finally {
        complete(kind, id, outcome);
      }
    },
  };
}

const operations = createAcknowledgments();

export async function trackSync(run: () => Promise<boolean>): Promise<boolean> {
  return (await operations.run("sync", async () => ((await run()) ? "done" : "failed"))) === "done";
}

export function AppIdle(): ReactElement | null {
  const client = useQueryClient();
  const fetching = useIsFetching();
  const startedWrites = useSyncActivity((state) => state.startedWrites);
  const completedWrites = useSyncActivity((state) => state.completedWrites);
  const inFlight = useSyncActivity((state) => state.pending);
  const checked = useSyncActivity((state) => state.checked);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;
  const [ready, setReady] = useState(false);
  const idle = checked && fetching === 0 && inFlight === 0 && durable === 0;
  const snapshot = useSyncExternalStore(operations.subscribe, operations.getSnapshot);

  useEffect(
    () =>
      useSyncActivity.subscribe((state, previous) => {
        const write = state.lastWrite;
        if (write === null || write === previous.lastWrite) return;
        void Promise.allSettled(
          client
            .getQueryCache()
            .getAll()
            .filter((query) => query.state.fetchStatus !== "idle")
            .map((query) => query.promise),
        ).then((reads) => {
          operations.complete(
            "write",
            write.id,
            reads.some((read) => read.status === "rejected") ? "failed" : write.outcome,
          );
        });
      }),
    [client],
  );

  useEffect(() => {
    if (!idle) return;
    setReady(true);
    listenForCommands();
  }, [idle]);

  return (
    <>
      {ready ? <Marker testID={HARNESS_IDS.appReady} /> : null}
      <Marker
        testID={HARNESS_IDS.operationStarted}
        accessibilityLabel={`write ${startedWrites}; sync ${snapshot.sync}; completed writes ${completedWrites}`}
      />
      <Marker testID={HARNESS_IDS.operationCompleted} accessibilityLabel={snapshot.completed} />
    </>
  );
}
