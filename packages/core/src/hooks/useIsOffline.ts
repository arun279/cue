import { useSyncExternalStore } from "react";
import { useNetwork } from "../ports/network";

/** Live connectivity as React state (SyncStrip's offline line, Search's offline notice). */
export function useIsOffline(): boolean {
  const network = useNetwork();
  return useSyncExternalStore(network.subscribe, () => !network.isOnline());
}
