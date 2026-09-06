import { createLazyRoute } from "@tanstack/react-router";
import { UpNext } from "@ui/screens/up-next/UpNext";

export const Route = createLazyRoute("/")({ component: UpNext });
