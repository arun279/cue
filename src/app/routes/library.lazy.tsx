import { createLazyRoute } from "@tanstack/react-router";
import { Library } from "@ui/screens/library/Library";

export const Route = createLazyRoute("/library")({ component: Library });
