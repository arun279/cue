import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export interface TvShowsOffProps {
  readonly body: string;
  readonly testID: string;
}

export function TvShowsOff({ body, testID }: TvShowsOffProps): ReactElement {
  const router = useRouter();

  return (
    <EmptyState testID={testID} headline="TV shows are turned off." body={body}>
      <Button label="Open Settings" variant="link" onPress={() => router.push("/settings")} />
    </EmptyState>
  );
}
