import { createLazyRoute, Link } from "@tanstack/react-router";
import { PlaceholderScreen } from "@ui/app-shell/PlaceholderScreen";

export const Route = createLazyRoute("/profile")({
  component: () => (
    <PlaceholderScreen
      title="Profile"
      description="Your watch stats and settings will be gathered here."
      testId="screen-profile"
    >
      <Link className="button" to="/settings" data-testid="link-settings">
        Settings &amp; connections
      </Link>
    </PlaceholderScreen>
  ),
});
