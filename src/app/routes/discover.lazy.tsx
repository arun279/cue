import { createLazyRoute } from "@tanstack/react-router";
import { PlaceholderScreen } from "@ui/app-shell/PlaceholderScreen";

export const Route = createLazyRoute("/discover")({
  component: () => (
    <PlaceholderScreen
      title="Discover"
      description="Trending shows, search, and things worth adding will live here."
      testId="screen-discover"
    />
  ),
});
