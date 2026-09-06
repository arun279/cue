import { createLazyRoute } from "@tanstack/react-router";
import { Settings } from "@ui/screens/settings/Settings";

export const Route = createLazyRoute("/settings")({ component: Settings });
