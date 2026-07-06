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
  /** True under Capacitor: device-code is the primary (and only working) native path. */
  readonly native: boolean;
}

export interface AuthActions {
  /** Web primary: stash a state nonce + PKCE verifier, redirect to Trakt's authorize page. */
  connectWithRedirect(): Promise<void>;
  /** Native primary + web fallback: request a device code and poll idle→connecting→success. */
  connectWithDeviceCode(): Promise<void>;
  /** Auth-code return: validate the state nonce, exchange the code, store the token. */
  completeRedirect(code: string | null, state: string | null): Promise<void>;
  /** Sign out: revoke the token and clear the store, back to onboarding. */
  disconnect(): Promise<void>;
  /** Runtime-triggered teardown when the refresh token is dead: clear + onboard (no revoke). */
  endSession(): Promise<void>;
  /** Abandon an in-flight device-code poll and return to the connect screen. */
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
