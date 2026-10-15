import { applyOptimisticWrite } from "@cue/core/hooks/optimistic-write";
import type { SubmitOptimistic } from "@cue/core/hooks/useOptimisticWrite";
import { useTrackedSubmit } from "@cue/core/hooks/useTrackedSubmit";
import { type SubmitOutcome, useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";

type Operation = "write" | "sync";

export function createAcknowledgments() {
  let snapshot = { write: 0, sync: 0, completed: ";" };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
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
        publish({ ...snapshot, completed: `${snapshot.completed} ${kind} ${id} ${outcome};` });
      }
    },
  };
}

const operations = createAcknowledgments();

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  const client = useQueryClient();
  return useCallback(
    (ops, effects) =>
      operations.run("write", async () => {
        const outcome = await applyOptimisticWrite(submit, ops, effects);
        const reads = await Promise.allSettled(
          client
            .getQueryCache()
            .getAll()
            .filter((query) => query.state.fetchStatus !== "idle")
            .map((query) => query.promise),
        );
        return reads.some((read) => read.status === "rejected") ? "failed" : outcome;
      }),
    [submit, client],
  );
}

export async function trackSync(run: () => Promise<boolean>): Promise<boolean> {
  return (await operations.run("sync", async () => ((await run()) ? "done" : "failed"))) === "done";
}

export function AppIdle(): ReactElement | null {
  const fetching = useIsFetching();
  const inFlight = useSyncActivity((state) => state.pending);
  const checked = useSyncActivity((state) => state.checked);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;
  const [ready, setReady] = useState(false);
  const idle = checked && fetching === 0 && inFlight === 0 && durable === 0;
  const snapshot = useSyncExternalStore(operations.subscribe, operations.getSnapshot);

  useEffect(() => {
    if (idle) setReady(true);
  }, [idle]);

  return (
    <>
      {ready ? <Marker testID={HARNESS_IDS.appReady} /> : null}
      <Marker
        testID={HARNESS_IDS.operationStarted}
        accessibilityLabel={`write ${snapshot.write}; sync ${snapshot.sync}`}
      />
      <Marker testID={HARNESS_IDS.operationCompleted} accessibilityLabel={snapshot.completed} />
    </>
  );
}
