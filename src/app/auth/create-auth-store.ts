import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  type OAuthConfig,
  pollDeviceToken,
  requestDeviceCode,
  revokeToken,
} from "@data/auth/oauth";
import type { Credentials } from "@domain/model/credentials";
import type { Token } from "@domain/model/token";
import type { CredsStore } from "@platform/creds-store";
import type { TokenStore } from "@platform/token-store";
import type { AuthActions, AuthState, AuthStore } from "@ui/auth/store";
import { createStore } from "zustand/vanilla";

const STATE_KEY = "cue.oauth.state";

export interface AuthDeps {
  readonly tokenStore: TokenStore;
  readonly credsStore: CredsStore;
  /** `${origin}/auth/callback` — the OAuth redirect target. */
  readonly redirectUri: string;
  /** Full-page navigation (injected so tests/native can override). */
  readonly redirect: (url: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function oauthConfig(creds: Credentials, redirectUri: string): OAuthConfig {
  return { clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri };
}

/**
 * The concrete auth store injected into the UI (composition
 * root): pure UI state in `@ui/auth/store`, side effects (persist token/creds,
 * OAuth network, full-page redirect) wired here where platform + data meet.
 */
export function createAuthStore(deps: AuthDeps): AuthStore {
  // Monotonic attempt id: every connect/cancel/disconnect bumps it, so a poll
  // sleeping from an earlier attempt can detect it no longer owns the flow and
  // bail before it polls or persists a stale token.
  let activeAttempt = 0;

  const store = createStore<AuthState & AuthActions>((set) => {
    async function persistToken(token: Token, creds: Credentials): Promise<void> {
      await deps.tokenStore.write(token);
      set({
        phase: "connected",
        connectStatus: "success",
        errorMessage: null,
        deviceCode: null,
        tmdbConfigured: creds.tmdbKey.trim().length > 0,
      });
    }

    async function pollLoop(
      deviceCode: string,
      intervalMs: number,
      creds: Credentials,
      attempt: number,
    ): Promise<void> {
      let interval = intervalMs;
      while (activeAttempt === attempt) {
        await sleep(interval);
        if (activeAttempt !== attempt) return;
        const result = await pollDeviceToken(oauthConfig(creds, deps.redirectUri), deviceCode);
        if (activeAttempt !== attempt) return;
        if (result.status === "pending") continue;
        if (result.status === "slow-down") {
          interval += 1000;
          continue;
        }
        if (result.status === "success") {
          await persistToken(result.token, creds);
          return;
        }
        set({
          connectStatus: "error",
          deviceCode: null,
          errorMessage:
            result.status === "denied"
              ? "You declined the request on Trakt."
              : result.status === "expired"
                ? "The code expired before it was approved. Try again."
                : "Trakt could not authorize this device. Try again.",
        });
        return;
      }
    }

    return {
      phase: "loading",
      connectStatus: "idle",
      errorMessage: null,
      deviceCode: null,
      tmdbConfigured: false,

      async connectWithRedirect(creds) {
        activeAttempt += 1;
        set({ connectStatus: "connecting", errorMessage: null });
        await deps.credsStore.write(creds);
        const state = crypto.randomUUID();
        sessionStorage.setItem(STATE_KEY, state);
        deps.redirect(buildAuthorizeUrl(oauthConfig(creds, deps.redirectUri), state));
      },

      async connectWithDeviceCode(creds) {
        activeAttempt += 1;
        const attempt = activeAttempt;
        set({ connectStatus: "connecting", errorMessage: null, deviceCode: null });
        await deps.credsStore.write(creds);
        try {
          const code = await requestDeviceCode(oauthConfig(creds, deps.redirectUri));
          if (activeAttempt !== attempt) return;
          set({ deviceCode: { userCode: code.userCode, verificationUrl: code.verificationUrl } });
          await pollLoop(code.deviceCode, code.intervalMs, creds, attempt);
        } catch {
          if (activeAttempt !== attempt) return;
          set({
            connectStatus: "error",
            errorMessage: "Could not reach Trakt. Check your connection.",
          });
        }
      },

      async completeRedirect(code, state) {
        set({ connectStatus: "connecting", errorMessage: null });
        const expected = sessionStorage.getItem(STATE_KEY);
        sessionStorage.removeItem(STATE_KEY);
        if (state === null || expected === null || state !== expected) {
          set({
            connectStatus: "error",
            errorMessage: "Sign-in could not be verified. Please try again.",
          });
          return;
        }
        if (code === null) {
          set({
            connectStatus: "error",
            errorMessage: "Trakt did not return an authorization code.",
          });
          return;
        }
        const creds = await deps.credsStore.read();
        if (creds === null) {
          set({
            connectStatus: "error",
            errorMessage: "Your credentials were not found. Please re-enter them.",
          });
          return;
        }
        try {
          const token = await exchangeCodeForToken(oauthConfig(creds, deps.redirectUri), code);
          await persistToken(token, creds);
        } catch {
          set({
            connectStatus: "error",
            errorMessage: "Trakt rejected the connection. Double-check your client secret.",
          });
        }
      },

      async disconnect() {
        activeAttempt += 1;
        const [token, creds] = await Promise.all([deps.tokenStore.read(), deps.credsStore.read()]);
        // Revoke is best-effort: a network/HTTP failure must not strand the
        // local session, so the clear below always runs.
        try {
          if (token !== null && creds !== null) {
            await revokeToken(oauthConfig(creds, deps.redirectUri), token.access_token);
          }
        } catch {
          // swallow: local clear is the source of truth for sign-out
        }
        await Promise.all([deps.tokenStore.clear(), deps.credsStore.clear()]);
        set({
          phase: "onboarding",
          connectStatus: "idle",
          errorMessage: null,
          deviceCode: null,
          tmdbConfigured: false,
        });
      },

      cancelConnect() {
        activeAttempt += 1;
        set({ connectStatus: "idle", errorMessage: null, deviceCode: null });
      },
    };
  });

  void (async () => {
    const [token, creds] = await Promise.all([deps.tokenStore.read(), deps.credsStore.read()]);
    // Creds-without-token is a legitimate mid-onboarding state (the redirect
    // flow stashes creds before the callback exchanges the token), so an absent
    // or schema-rejected token simply means "not connected yet".
    if (token === null) {
      store.setState({ phase: "onboarding", tmdbConfigured: false });
      return;
    }
    // A token WITHOUT valid creds is unrecoverable — creds carry the client
    // secret that refresh/revoke need — so drop the orphaned token and onboard.
    if (creds === null) {
      await deps.tokenStore.clear();
      store.setState({ phase: "onboarding", tmdbConfigured: false });
      return;
    }
    store.setState({
      phase: "connected",
      tmdbConfigured: creds.tmdbKey.trim().length > 0,
    });
  })();

  return store;
}
