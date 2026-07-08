import { createLazyRoute } from "@tanstack/react-router";
import { History } from "@ui/screens/history/History";

export const Route = createLazyRoute("/history")({ component: History });
