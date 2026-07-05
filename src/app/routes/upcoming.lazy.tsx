import { createLazyRoute } from "@tanstack/react-router";
import { PlaceholderScreen } from "@ui/app-shell/PlaceholderScreen";

export const Route = createLazyRoute("/upcoming")({
  component: () => (
    <PlaceholderScreen
      title="Upcoming"
      description="Episodes airing soon for the shows you follow will appear here."
      testId="screen-upcoming"
    />
  ),
});
