import type { ReactElement } from "react";
import { View } from "react-native";
import type { TraktFailure } from "@/core/data/trakt/client";
import { readFailureBody } from "@/core/sync-contract";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { SPACE } from "../../ui/tokens";

export function DetailSkeleton({ testID }: { readonly testID: string }): ReactElement {
  return (
    <View testID={testID} accessibilityLabel="Loading" style={{ gap: SPACE.s4 }}>
      <Skeleton width="100%" height={214} radius={0} />
      <Skeleton width="70%" height={28} />
      <Skeleton width="90%" height={16} />
      <Skeleton width="80%" height={16} />
    </View>
  );
}

export function DetailError({
  subject,
  failure,
  onRetry,
}: {
  readonly subject: string;
  readonly failure: TraktFailure | null;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <EmptyState centered headline={`Couldn't load ${subject}`} body={readFailureBody(failure)}>
      <Button label="Retry" onPress={onRetry} />
    </EmptyState>
  );
}
