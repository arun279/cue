import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseId } from "../../../../src/route-params";
import NotFound from "../../../../src/screens/NotFound";
import { ShowDetail } from "../../../../src/screens/ShowDetail";

export default function ShowRoute(): ReactElement {
  const showId = parseId(useLocalSearchParams<{ showId: string }>().showId);
  if (showId === null) return <NotFound />;
  return <ShowDetail showId={showId} />;
}
