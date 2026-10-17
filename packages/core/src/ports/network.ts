import { createContext, useContext } from "react";

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
