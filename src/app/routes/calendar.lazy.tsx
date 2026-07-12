import { createLazyRoute } from "@tanstack/react-router";
import { Calendar } from "@ui/screens/calendar/Calendar";

export const Route = createLazyRoute("/calendar")({
  component: Calendar,
});
