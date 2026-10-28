import { useSyncExternalStore } from "react";
import { readRetryFailure, subscribeReadRetry } from "../data/trakt/read-budget";
import type { TraktFailure } from "../domain/read-failure";

export function useReadRetry(): TraktFailure | null {
  return useSyncExternalStore(subscribeReadRetry, readRetryFailure);
}
