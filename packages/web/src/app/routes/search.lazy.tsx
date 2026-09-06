import { createLazyRoute } from "@tanstack/react-router";
import { Search } from "@ui/screens/search/Search";

export const Route = createLazyRoute("/search")({
  component: Search,
});
