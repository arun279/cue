import { router } from "@app/router";
import { RuntimeBoot } from "@app/runtime/RuntimeBoot";
import type { KeyValueStore } from "@platform/kv";
import type { TokenStore } from "@platform/token-store";
import { RouterProvider } from "@tanstack/react-router";
import { type AuthStore, AuthStoreProvider, useAuth } from "@ui/auth/store";
import { Onboarding } from "@ui/screens/onboarding/Onboarding";
import type { ReactElement } from "react";

export interface RuntimeStores {
  readonly tokenStore: TokenStore;
  readonly kv: KeyValueStore;
  /** `${origin}/auth/callback` — threaded to the runtime for the refresh grant. */
  readonly redirectUri: string;
}

/**
 * First-run gate: until a token is stored the
 * app is the full-screen onboarding flow; once connected it is the routed shell,
 * wrapped in the authenticated runtime (Trakt client + durable write-queue). The
 * `/auth/callback` route renders bare (pre-token) so the redirect return can
 * complete its exchange before the runtime boots.
 */
function Gate({ stores }: { stores: RuntimeStores }): ReactElement {
  const phase = useAuth((s) => s.phase);
  const onCallback = globalThis.location.pathname === "/auth/callback";

  if (phase === "connected") {
    return (
      <RuntimeBoot {...stores}>
        <RouterProvider router={router} />
      </RuntimeBoot>
    );
  }
  if (onCallback) return <RouterProvider router={router} />;
  if (phase === "loading") {
    return (
      <main className="onboarding" data-testid="auth-loading">
        <p className="onboarding__lead" role="status">
          Loading…
        </p>
      </main>
    );
  }
  return <Onboarding />;
}

export function AuthGate({
  store,
  stores,
}: {
  store: AuthStore;
  stores: RuntimeStores;
}): ReactElement {
  return (
    <AuthStoreProvider value={store}>
      <Gate stores={stores} />
    </AuthStoreProvider>
  );
}
