import { createLazyRoute } from "@tanstack/react-router";
import { MyShows } from "@ui/screens/my-shows/MyShows";

export const Route = createLazyRoute("/my-shows")({ component: MyShows });
