import type { Credentials } from "@domain/model/credentials";
import { createContext, useContext } from "react";
import { type StoreApi, useStore } from "zustand";

/** Where the connect attempt is in its lifecycle. */
type ConnectStatus = "idle" | "connecting" | "error" | "success";

/** The device code shown to the user while the poll runs (mobile + web fallback). */
interface DeviceCodeView {
  readonly userCode: string;
  readonly verificationUrl: string;
}

export interface AuthState {
  /** `loading` until the persisted token is read; then `onboarding` or `connected`. */
  readonly phase: "loading" | "onboarding" | "connected";
  readonly connectStatus: ConnectStatus;
  readonly errorMessage: string | null;
  readonly deviceCode: DeviceCodeView | null;
  readonly tmdbConfigured: boolean;
}

export interface AuthActions {
  /** Web primary: persist creds, stash a state nonce, redirect to Trakt's authorize page. */
  connectWithRedirect(creds: Credentials): Promise<void>;
  /** Mobile + web fallback: request a device code and poll idle→connecting→success. */
  connectWithDeviceCode(creds: Credentials): Promise<void>;
  /** Auth-code return: validate the state nonce, exchange the code, store the token. */
  completeRedirect(code: string | null, state: string | null): Promise<void>;
  /** Sign out: revoke the token and clear the store, back to onboarding. */
  disconnect(): Promise<void>;
  /** Abandon an in-flight device-code poll and return to the form. */
  cancelConnect(): void;
}

export type AuthStore = StoreApi<AuthState & AuthActions>;

const AuthStoreContext = createContext<AuthStore | null>(null);

export const AuthStoreProvider = AuthStoreContext.Provider;

/** Select from the injected auth store; throws if used outside the provider. */
export function useAuth<T>(selector: (state: AuthState & AuthActions) => T): T {
  const store = useContext(AuthStoreContext);
  if (store === null) throw new Error("useAuth must be used within an AuthStoreProvider.");
  return useStore(store, selector);
}
