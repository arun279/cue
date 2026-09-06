import { createLazyRoute } from "@tanstack/react-router";
import { ShowDetail } from "@ui/screens/show-detail/ShowDetail";
import type { ReactElement } from "react";

export const Route = createLazyRoute("/show/$showId")({ component: ShowDetailRoute });

function ShowDetailRoute(): ReactElement {
  const { showId } = Route.useParams();
  return <ShowDetail showId={Number(showId)} />;
}
