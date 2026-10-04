import { useSyncExternalStore } from "react";
import { useNetwork } from "../ports/network";

export function useIsOffline(): boolean {
  const network = useNetwork();
  return useSyncExternalStore(network.subscribe, () => !network.isOnline());
}
