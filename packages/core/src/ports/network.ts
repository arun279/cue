import { createContext, useContext } from "react";

/**
 * Whether the device believes it has a network, and a subscription to that
 * changing, injected from the composition root so the shared layer never reads
 * `navigator`. Both halves are advisory on every platform: a reachable radio is
 * not a reachable Trakt, so this drives what the UI says and when a deferred
 * write is retried, never whether a request is attempted. The default is
 * always-online-never-changing, so an isolated test needs no provider.
 */
export interface Network {
  isOnline(): boolean;
  subscribe(listener: () => void): () => void;
}

const ALWAYS_ONLINE: Network = {
  isOnline: () => true,
  subscribe: () => () => {},
};

const NetworkContext = createContext<Network>(ALWAYS_ONLINE);

export const NetworkProvider = NetworkContext.Provider;

export function useNetwork(): Network {
  return useContext(NetworkContext);
}
