import { useSyncExternalStore } from "react";
import type { TraktFailure } from "../data/trakt/client";
import { readRetryFailure, subscribeReadRetry } from "../data/trakt/read-budget";

export function useReadRetry(): TraktFailure | null {
  return useSyncExternalStore(subscribeReadRetry, readRetryFailure);
}
