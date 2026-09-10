import { Redirect, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseId } from "../../../../src/route-params";
import { ShowDetail } from "../../../../src/screens/ShowDetail";

export default function ShowRoute(): ReactElement {
  const showId = parseId(useLocalSearchParams<{ showId: string }>().showId);
  if (showId === null) return <Redirect href="/+not-found" />;
  return <ShowDetail showId={showId} />;
}
