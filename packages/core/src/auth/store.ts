import { createContext, useContext } from "react";
import { type StoreApi, useStore } from "zustand";

type ConnectStatus = "idle" | "connecting" | "error" | "success";

interface DeviceCodeView {
  readonly userCode: string;
  readonly verificationUrl: string;
}

export interface AuthState {
  readonly phase: "loading" | "onboarding" | "connected";
  readonly connectStatus: ConnectStatus;
  readonly errorMessage: string | null;
  readonly deviceCode: DeviceCodeView | null;
  readonly native: boolean;
}

export interface AuthActions {
  connectWithRedirect(): Promise<void>;
  connectWithDeviceCode(): Promise<void>;
  completeRedirect(code: string | null, state: string | null): Promise<void>;
  disconnect(): Promise<void>;
  endSession(): Promise<void>;
  cancelConnect(): void;
}

export type AuthStore = StoreApi<AuthState & AuthActions>;

const AuthStoreContext = createContext<AuthStore | null>(null);

export const AuthStoreProvider = AuthStoreContext.Provider;

export function useAuth<T>(selector: (state: AuthState & AuthActions) => T): T {
  const store = useContext(AuthStoreContext);
  if (store === null) throw new Error("useAuth must be used within an AuthStoreProvider.");
  return useStore(store, selector);
}
