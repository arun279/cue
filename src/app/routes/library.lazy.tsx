import { createLazyRoute } from "@tanstack/react-router";
import { Library } from "@ui/screens/my-shows/Library";

export const Route = createLazyRoute("/library")({ component: Library });
