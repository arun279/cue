import { queryKeys } from "@cue/core/data/query-keys";
import { snackText, useSnackbar } from "@cue/core/stores/snackbar-store";
import { useSyncExternalStore } from "react";
import { queryClient } from "../platform/query-persister";

const listeners = new Set<() => void>();
let shownAt = 0;
let trace: string | null = null;

function publish(next: string): void {
  trace = next;
  for (const listener of listeners) listener();
}

function record(event: string): void {
  if (trace !== null) publish(`${trace}; ${event} +${Math.round(performance.now() - shownAt)} ms`);
}

useSnackbar.subscribe(({ snack }, previous) => {
  if (snack === previous.snack) return;
  if (snack === null) return record("dismissed");
  shownAt = performance.now();
  const actions = (snack.actions ?? []).map((action) => action.label).join(", ");
  publish(`Snackbar ${snack.seq} "${snackText(snack.message)}" [${actions}]`);
});

queryClient.getQueryCache().subscribe((event) => {
  if (
    event.type === "updated" &&
    event.action.type === "success" &&
    event.action.manual !== true &&
    event.query.queryKey[0] === queryKeys.library()[0] &&
    useSnackbar.getState().snack !== null
  ) {
    record("queue refetched");
  }
});

export function useSnackbarTrace(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => trace,
  );
}
