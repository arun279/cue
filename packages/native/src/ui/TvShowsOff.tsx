import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export interface TvShowsOffProps {
  /** What this screen loses while shows are off, in the grammar of the movie
   * notice it mirrors, so the two media stay symmetric. */
  readonly body: string;
  readonly testID: string;
}

/**
 * The media-visibility branch, which is not one of a screen's data states: it is
 * decided by a Settings switch rather than by what the library holds, and the
 * screen that draws it issues no show reads at all.
 */
export function TvShowsOff({ body, testID }: TvShowsOffProps): ReactElement {
  const router = useRouter();

  return (
    <EmptyState testID={testID} headline="TV shows are turned off." body={body}>
      <Button label="Open Settings" variant="link" onPress={() => router.push("/settings")} />
    </EmptyState>
  );
}
