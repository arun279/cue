import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";
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
  onRetry,
}: {
  readonly subject: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <EmptyState
      centered
      headline={`Couldn't load ${subject}`}
      body="Check your connection and try again."
    >
      <Button label="Retry" onPress={onRetry} />
    </EmptyState>
  );
}

export function ShowDisabled(): ReactElement {
  const router = useRouter();
  return (
    <EmptyState
      headline="TV shows are turned off."
      body="Turn TV shows back on in Settings to see this show."
    >
      <Button label="Open Settings" onPress={() => router.push("/settings")} />
    </EmptyState>
  );
}
