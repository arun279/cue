import { createStore } from "zustand/vanilla";
import { PendingWritesError, sessionTeardown } from "../app/session";
import {
  buildAuthorizeUrl,
  type DeviceTokenResult,
  exchangeCodeForToken,
  type OAuthConfig,
  pollDeviceToken,
  requestDeviceCode,
  revokeToken,
} from "../data/auth/oauth";
import { createPkcePair } from "../data/auth/pkce";
import type { Token } from "../domain/model/token";
import type { RedirectHandoff } from "../ports/redirect-handoff";
import type { TokenStore } from "../ports/token-store";
import type { AuthActions, AuthState, AuthStore } from "./store";

export interface AuthDeps {
  readonly tokenStore: TokenStore;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly redirect: (url: string) => void;
  readonly redirectHandoff: RedirectHandoff;
  /** Capacitor cannot return through a browser redirect. */
  readonly native: boolean;
  readonly traktBaseUrl: string | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SESSION_UNREADABLE = "Cue could not read your saved sign-in. Connect again to continue.";

export function createAuthStore(deps: AuthDeps): AuthStore {
  const config: OAuthConfig = {
    clientId: deps.clientId,
    redirectUri: deps.redirectUri,
    apiBaseUrl: deps.traktBaseUrl,
    siteBaseUrl: deps.traktBaseUrl,
  };

  let activeAttempt = 0;

  const store = createStore<AuthState & AuthActions>((set) => {
    const toOnboarding = (): void => {
      set({
        phase: "onboarding",
        connectStatus: "idle",
        errorMessage: null,
        deviceCode: null,
      });
    };

    async function persistToken(token: Token): Promise<void> {
      await deps.tokenStore.write(token);
      set({
        phase: "connected",
        connectStatus: "success",
        errorMessage: null,
        deviceCode: null,
      });
    }

    async function applyDevicePoll(
      result: DeviceTokenResult,
    ): Promise<"pending" | "slow-down" | "done"> {
      if (result.status === "pending" || result.status === "slow-down") return result.status;
      if (result.status === "success") {
        await persistToken(result.token);
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
      deviceCode: string,
      verifier: string,
      attempt: number,
      interval: number,
    ): Promise<"cancelled" | "pending" | "slow-down" | "done"> {
      await sleep(interval);
      if (activeAttempt !== attempt) return "cancelled";
      const result = await pollDeviceToken(config, deviceCode, verifier);
      if (activeAttempt !== attempt) return "cancelled";
      return applyDevicePoll(result);
    }

    async function pollLoop(
      deviceCode: string,
      intervalMs: number,
      verifier: string,
      attempt: number,
    ): Promise<void> {
      let interval = intervalMs;
      while (activeAttempt === attempt) {
        const outcome = await pollAttempt(deviceCode, verifier, attempt, interval);
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
      native: deps.native,

      async connectWithRedirect() {
        activeAttempt += 1;
        set({ connectStatus: "connecting", errorMessage: null });
        const state = crypto.randomUUID();
        const { verifier, challenge } = await createPkcePair();
        deps.redirectHandoff.write(state, verifier);
        deps.redirect(buildAuthorizeUrl(config, state, challenge));
      },

      async connectWithDeviceCode() {
        activeAttempt += 1;
        const attempt = activeAttempt;
        set({ connectStatus: "connecting", errorMessage: null, deviceCode: null });
        try {
          const { verifier, challenge } = await createPkcePair();
          const code = await requestDeviceCode(config, challenge);
          if (activeAttempt !== attempt) return;
          set({ deviceCode: { userCode: code.userCode, verificationUrl: code.verificationUrl } });
          await pollLoop(code.deviceCode, code.intervalMs, verifier, attempt);
        } catch {
          if (activeAttempt !== attempt) return;
          set({
            connectStatus: "error",
            errorMessage: "Couldn't reach Trakt. Check your connection and try again.",
          });
        }
      },

      async completeRedirect(code, state) {
        set({ connectStatus: "connecting", errorMessage: null });
        const stashed = deps.redirectHandoff.read();
        if (state === null || stashed === null || state !== stashed.state) {
          set({
            connectStatus: "error",
            errorMessage: "We couldn't verify that sign-in. Please try again.",
          });
          return;
        }
        const { verifier } = stashed;
        deps.redirectHandoff.clear();
        if (code === null) {
          set({
            connectStatus: "error",
            errorMessage: "Sign-in didn't complete. Please try again.",
          });
          return;
        }
        try {
          const token = await exchangeCodeForToken(config, code, verifier);
          await persistToken(token);
        } catch {
          set({
            connectStatus: "error",
            errorMessage: "We couldn't finish connecting to Trakt. Please try again.",
          });
        }
      },

      async disconnect() {
        activeAttempt += 1;
        try {
          await sessionTeardown.run();
        } catch (error) {
          if (error instanceof PendingWritesError) throw error;
        }
        const token = await deps.tokenStore.read();
        if (token !== null) await revokeToken(config, token.access_token).catch(() => undefined);
        await deps.tokenStore.clear();
        toOnboarding();
      },

      async endSession() {
        activeAttempt += 1;
        await sessionTeardown.run({ force: true }).catch(() => undefined);
        await deps.tokenStore.clear();
        toOnboarding();
      },

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
