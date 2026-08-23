import { createLazyRoute } from "@tanstack/react-router";
import { Profile } from "@ui/screens/profile/Profile";

export const Route = createLazyRoute("/profile")({
  component: Profile,
});
