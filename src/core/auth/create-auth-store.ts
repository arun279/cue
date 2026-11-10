import { createStore } from "zustand/vanilla";
import {
  type DeviceCode,
  type DeviceTokenResult,
  type OAuthConfig,
  pollDeviceToken,
  requestDeviceCode,
  revokeToken,
} from "../data/auth/oauth";
import { createPkcePair } from "../data/auth/pkce";
import { sleep } from "../domain/abortable";
import type { Token } from "../domain/model/token";
import type { CryptoPort } from "../ports/crypto";
import type { TokenStore } from "../ports/token-store";
import type { AuthActions, AuthState, AuthStore } from "./store";

export interface AuthDeps {
  readonly crypto: CryptoPort;
  readonly tokenStore: TokenStore;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly traktBaseUrl: string | undefined;
  /** Runs before a sign-in saves its token. */
  readonly clearAccount: () => Promise<void>;
}

const SESSION_UNREADABLE = "Cue could not read your saved sign-in. Connect again to continue.";
const ACCOUNT_NOT_CLEARED =
  "Cue couldn't remove the previous account's data from this device. Try again.";

export function createAuthStore(deps: AuthDeps): AuthStore {
  const config: OAuthConfig = {
    clientId: deps.clientId,
    redirectUri: deps.redirectUri,
    apiBaseUrl: deps.traktBaseUrl,
  };

  let activeAttempt = 0;
  // A sign-out or a dead token ends the session it started in, never a later one.
  let session = 0;
  let disconnecting: { readonly session: number; readonly done: Promise<void> } | null = null;

  const store = createStore<AuthState & AuthActions>((set) => {
    const toOnboarding = (): void => {
      set({
        phase: "onboarding",
        connectStatus: "idle",
        errorMessage: null,
        deviceCode: null,
      });
    };

    function endSessionFrom(started: number): void {
      if (started !== session) return;
      session += 1;
      activeAttempt += 1;
      void deps.tokenStore.clear();
      toOnboarding();
    }

    async function revokeStoredToken(): Promise<void> {
      const token = await deps.tokenStore.read();
      if (token !== null) await revokeToken(config, token.access_token).catch(() => undefined);
    }

    async function connect(token: Token, attempt: number): Promise<void> {
      try {
        await deps.clearAccount();
      } catch {
        if (activeAttempt === attempt) {
          set({ connectStatus: "error", deviceCode: null, errorMessage: ACCOUNT_NOT_CLEARED });
        }
        return;
      }
      if (activeAttempt !== attempt) return;
      void deps.tokenStore.write(token);
      set({
        phase: "connected",
        connectStatus: "success",
        errorMessage: null,
        deviceCode: null,
      });
    }

    async function applyDevicePoll(
      result: DeviceTokenResult,
      attempt: number,
    ): Promise<"pending" | "slow-down" | "done"> {
      if (result.status === "pending" || result.status === "slow-down") return result.status;
      if (result.status === "success") {
        await connect(result.token, attempt);
        return "done";
      }
      const messages = {
        denied: "You declined the request in Trakt. Try again when you're ready.",
        expired: "That code expired before it was approved. Start again to get a new one.",
        error: "Trakt could not authorize this device. Try again.",
      };
      set({
        connectStatus: "error",
        deviceCode: null,
        errorMessage: messages[result.status],
      });
      return "done";
    }

    async function pollAttempt(
      poll: () => Promise<DeviceTokenResult>,
      attempt: number,
      interval: number,
    ): Promise<"cancelled" | "pending" | "slow-down" | "done"> {
      await sleep(interval);
      if (activeAttempt !== attempt) return "cancelled";
      const result = await poll();
      if (activeAttempt !== attempt) return "cancelled";
      return applyDevicePoll(result, attempt);
    }

    async function pollLoop(code: DeviceCode, verifier: string, attempt: number): Promise<void> {
      const expiresAt = Date.now() + code.expiresInMs;
      const poll = () =>
        pollDeviceToken(config, code.deviceCode, verifier).catch(
          (): DeviceTokenResult => ({ status: Date.now() < expiresAt ? "pending" : "expired" }),
        );
      let interval = code.intervalMs;
      while (activeAttempt === attempt) {
        const outcome = await pollAttempt(poll, attempt, interval);
        if (outcome === "slow-down") {
          interval += 1000;
          continue;
        }
        if (outcome !== "pending") return;
      }
    }

    return {
      phase: "loading",
      connectStatus: "idle",
      errorMessage: null,
      deviceCode: null,

      async connectWithDeviceCode() {
        activeAttempt += 1;
        const attempt = activeAttempt;
        set({ connectStatus: "connecting", errorMessage: null, deviceCode: null });
        try {
          const { verifier, challenge } = await createPkcePair(deps.crypto);
          const code = await requestDeviceCode(config, challenge);
          if (activeAttempt !== attempt) return;
          set({ deviceCode: { userCode: code.userCode, verificationUrl: code.verificationUrl } });
          await pollLoop(code, verifier, attempt);
        } catch {
          if (activeAttempt !== attempt) return;
          set({
            connectStatus: "error",
            errorMessage: "Couldn't reach Trakt. Check your connection and try again.",
            deviceCode: null,
          });
        }
      },

      disconnect() {
        if (disconnecting?.session !== session) {
          const started = session;
          disconnecting = {
            session: started,
            done: revokeStoredToken().then(
              () => endSessionFrom(started),
              (error: unknown) => {
                disconnecting = null;
                throw error;
              },
            ),
          };
        }
        return disconnecting.done;
      },

      endSession: () => endSessionFrom(session),

      cancelConnect() {
        activeAttempt += 1;
        set({ connectStatus: "idle", errorMessage: null, deviceCode: null });
      },
    };
  });

  void (async () => {
    try {
      const token = await deps.tokenStore.read();
      store.setState({ phase: token === null ? "onboarding" : "connected" });
    } catch {
      store.setState({ phase: "onboarding", errorMessage: SESSION_UNREADABLE });
    }
  })();

  return store;
}
