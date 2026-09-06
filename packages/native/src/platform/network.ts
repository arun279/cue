import type { Network } from "@cue/core/ports/network";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";

/**
 * `expo-network`'s state is asynchronous and the port is not, because the port's
 * consumers ask during a render. So the last state the OS reported is kept here
 * and the subscription keeps it current, with the optimistic default the web
 * side also takes: both halves are advisory on every platform, a reachable radio
 * is not a reachable Trakt, and this drives what the UI says and when a deferred
 * write is retried, never whether a request is attempted.
 */
export function createNativeNetwork(): Network {
  let online = true;
  const listeners = new Set<() => void>();

  const apply = (connected: boolean | undefined): void => {
    const next = connected !== false;
    if (next === online) return;
    online = next;
    for (const listener of listeners) listener();
  };

  // A failed first read leaves the optimistic default in place, which is the
  // same answer this port gives before the OS has said anything.
  void getNetworkStateAsync()
    .then((state) => apply(state.isConnected))
    .catch(() => {});
  addNetworkStateListener((state) => apply(state.isConnected));

  return {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
