import { createStore } from "zustand/vanilla";
import { PendingWritesError, sessionTeardown } from "../app/session";
import {
  buildAuthorizeUrl,
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
  /** The app's public Trakt client id, embedded at build time. */
  readonly clientId: string;
  /** `${origin}/auth/callback`: the OAuth redirect target. */
  readonly redirectUri: string;
  /** Full-page navigation (injected so tests/native can override). */
  readonly redirect: (url: string) => void;
  /** Where the state nonce and the PKCE verifier wait out that navigation. */
  readonly redirectHandoff: RedirectHandoff;
  /** True under Capacitor: device-code is the primary native path (redirect can't return). */
  readonly native: boolean;
  /** Trakt origin override; undefined leaves the flow on the real Trakt hosts. */
  readonly traktBaseUrl: string | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The concrete auth store injected into the UI (composition
 * root): pure UI state in `@ui/auth/store`, side effects (persist token, OAuth
 * network, full-page redirect) wired here where platform + data meet. The public
 * client id is embedded once by the app author, not entered per user.
 */
export function createAuthStore(deps: AuthDeps): AuthStore {
  // One override drives both origins because the mock serves both: the token,
  // device and revoke endpoints Trakt puts on `api.trakt.tv`, and the authorize
  // page it puts on `trakt.tv`.
  const config: OAuthConfig = {
    clientId: deps.clientId,
    redirectUri: deps.redirectUri,
    apiBaseUrl: deps.traktBaseUrl,
    siteBaseUrl: deps.traktBaseUrl,
  };

  // Monotonic attempt id: every connect/cancel/disconnect bumps it, so a poll
  // sleeping from an earlier attempt can detect it no longer owns the flow and
  // bail before it polls or persists a stale token.
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

    async function pollLoop(
      deviceCode: string,
      intervalMs: number,
      verifier: string,
      attempt: number,
    ): Promise<void> {
      let interval = intervalMs;
      while (activeAttempt === attempt) {
        await sleep(interval);
        if (activeAttempt !== attempt) return;
        const result = await pollDeviceToken(config, deviceCode, verifier);
        if (activeAttempt !== attempt) return;
        if (result.status === "pending") continue;
        if (result.status === "slow-down") {
          interval += 1000;
          continue;
        }
        if (result.status === "success") {
          await persistToken(result.token);
          return;
        }
        set({
          connectStatus: "error",
          deviceCode: null,
          errorMessage:
            result.status === "denied"
              ? "You declined the request in Trakt. Try again when you're ready."
              : result.status === "expired"
                ? "That code expired before it was approved. Start again to get a new one."
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
        // Validate BEFORE consuming: a stray or tampered callback (bad/absent
        // state) must not wipe the verifier of an in-progress attempt.
        if (state === null || stashed === null || state !== stashed.state) {
          set({
            connectStatus: "error",
            errorMessage: "We couldn't verify that sign-in. Please try again.",
          });
          return;
        }
        // State accepted: the single-use nonce + verifier are now spent.
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
        // Flush any pending writes and clear this device's caches (op-log,
        // last-activities baseline, persisted query cache) FIRST, while the token
        // is still valid: so a queued write isn't lost and the next account never
        // paints stale data.
        try {
          await sessionTeardown.run();
        } catch (error) {
          // Writes still queued: keep the user connected (staying signed in is what
          // protects the queued writes from loss AND from replaying under another
          // account) and surface it so they can reconnect + retry.
          if (error instanceof PendingWritesError) throw error;
          // Any other teardown fault must not strand sign-out: proceed to clear.
        }
        const token = await deps.tokenStore.read();
        // Revoke is best-effort: a network/HTTP failure must not strand the
        // local session, so the clear below always runs.
        try {
          if (token !== null) await revokeToken(config, token.access_token);
        } catch {
          // swallow: local clear is the source of truth for sign-out
        }
        await deps.tokenStore.clear();
        toOnboarding();
      },

      async endSession() {
        // The runtime found the refresh token dead (invalid_grant). The token is
        // already useless, so skip the network revoke disconnect does. Force-clear
        // this device's per-account state (op-log, last-activities baseline,
        // persisted query cache) so a leftover op can't replay under the next
        // account: the dead token can't send those writes anyway. Best-effort:
        // a teardown fault must not block routing back to onboarding.
        activeAttempt += 1;
        try {
          await sessionTeardown.run({ force: true });
        } catch {
          // swallow: clearing the token + onboarding is the source of truth here
        }
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
    // Token-only boot: the client id is a build-time constant, so a stored token
    // is the whole session. An absent or schema-rejected token means "not
    // connected yet" and drops to onboarding.
    const token = await deps.tokenStore.read();
    store.setState({ phase: token === null ? "onboarding" : "connected" });
  })();

  return store;
}
