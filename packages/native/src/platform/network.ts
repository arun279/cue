import type { Network } from "@cue/core/ports/network";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";

export function createNativeNetwork(): Network {
  let online = true;
  const listeners = new Set<() => void>();

  const apply = (connected: boolean | undefined): void => {
    const next = connected !== false;
    if (next === online) return;
    online = next;
    for (const listener of listeners) listener();
  };

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
