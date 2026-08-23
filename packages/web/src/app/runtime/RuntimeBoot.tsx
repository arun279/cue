import { TRAKT_BASE_OVERRIDE, TRAKT_CLIENT_ID } from "@app/config";
import { clearPersistedCaches } from "@app/query-client";
import { useAuth } from "@cue/core/auth/store";
import { useEpisodeReminders } from "@cue/core/hooks/useEpisodeReminders";
import type { KeyValueStore } from "@cue/core/ports/kv";
import type { TokenStore } from "@cue/core/ports/token-store";
import { useRuntimeBoot } from "@cue/core/runtime/boot";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import { clearLocalPreferences } from "@ui/prefs/preference-storage";
import type { ReactElement, ReactNode } from "react";

/** The reminder scheduler reads the calendar, so it runs under the runtime and
 * for exactly as long as the runtime exists. */
function EpisodeReminders(): null {
  useEpisodeReminders();
  return null;
}

export interface RuntimeBootProps {
  readonly tokenStore: TokenStore;
  readonly kv: KeyValueStore;
  /** `${origin}/auth/callback`: passed to the runtime for the token-refresh grant. */
  readonly redirectUri: string;
  readonly children: ReactNode;
}

/**
 * The web app's three boot surfaces over the shared boot effect: loading, a
 * retryable failure, and the runtime handed to the tree through context. The
 * effect itself (read the token, restore and replay the durable write-queue,
 * register the teardown) is in `@cue/core/runtime/boot` and is the same on both
 * targets; only these three renders differ.
 */
export function RuntimeBoot({
  tokenStore,
  kv,
  redirectUri,
  children,
}: RuntimeBootProps): ReactElement {
  // A dead refresh token routes through the auth store's teardown → onboarding.
  const endSession = useAuth((s) => s.endSession);
  const { runtime, failed, retry } = useRuntimeBoot({
    tokenStore,
    kv,
    redirectUri,
    clientId: TRAKT_CLIENT_ID,
    apiBaseUrl: TRAKT_BASE_OVERRIDE,
    endSession,
    clearPersistedCaches,
    clearLocalPreferences,
  });

  if (failed && runtime === null) {
    return (
      <main className="onb" data-testid="runtime-error">
        <section className="onb__card">
          <p className="onb__lead" role="alert">
            Couldn't start Cue.
          </p>
          <button
            type="button"
            className="onb__cta"
            data-testid="runtime-error-retry"
            onClick={retry}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (runtime === null) {
    return (
      <main className="onb" data-testid="runtime-loading">
        <p className="onb__lead" role="status">
          Loading your queue…
        </p>
      </main>
    );
  }

  return (
    <RuntimeProvider value={runtime}>
      <EpisodeReminders />
      {children}
    </RuntimeProvider>
  );
}
