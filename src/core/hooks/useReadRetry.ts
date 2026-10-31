import { useSyncExternalStore } from "react";
import type { TraktFailure } from "../domain/read-failure";
import { useRuntime } from "../runtime/runtime";

export function useReadRetry(): TraktFailure | null {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.subscribeReadRetry, runtime.readRetryFailure);
}
