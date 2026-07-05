import { router } from "@app/router";
import { RouterProvider } from "@tanstack/react-router";
import { type AuthStore, AuthStoreProvider, useAuth } from "@ui/auth/store";
import { Onboarding } from "@ui/screens/onboarding/Onboarding";
import type { ReactElement } from "react";

/**
 * First-run gate: until a token is stored the
 * app is the full-screen onboarding flow; once connected it is the routed shell.
 * The `/auth/callback` route always renders so the redirect return can complete
 * its exchange before a token exists.
 */
function Gate(): ReactElement {
  const phase = useAuth((s) => s.phase);
  const onCallback = globalThis.location.pathname === "/auth/callback";

  if (onCallback || phase === "connected") return <RouterProvider router={router} />;
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

export function AuthGate({ store }: { store: AuthStore }): ReactElement {
  return (
    <AuthStoreProvider value={store}>
      <Gate />
    </AuthStoreProvider>
  );
}
