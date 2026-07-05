import { createLazyRoute } from "@tanstack/react-router";
import { PlaceholderScreen } from "@ui/app-shell/PlaceholderScreen";

/**
 * Placeholder for the OAuth auth-code return. Later work fills in the
 * `state`-nonce check + code exchange; this step only proves the route exists so the
 * redirect has somewhere to land.
 */
export const Route = createLazyRoute("/auth/callback")({
  component: () => (
    <PlaceholderScreen
      title="Connecting to Trakt"
      description="Finishing sign-in. This is where the OAuth redirect returns."
      testId="screen-auth-callback"
    />
  ),
});
