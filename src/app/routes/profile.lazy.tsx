import { createLazyRoute } from "@tanstack/react-router";
import { PlaceholderScreen } from "@ui/app-shell/PlaceholderScreen";

export const Route = createLazyRoute("/profile")({
  component: () => (
    <PlaceholderScreen
      title="Profile"
      description="Your watch stats and settings will be gathered here."
      testId="screen-profile"
    />
  ),
});
