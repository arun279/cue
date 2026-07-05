import { createLazyRoute } from "@tanstack/react-router";
import { Upcoming } from "@ui/screens/upcoming/Upcoming";

export const Route = createLazyRoute("/upcoming")({
  component: Upcoming,
});
