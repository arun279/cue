import { Stack } from "expo-router";
import { memo, type ReactElement } from "react";

export const ScreenTitle = memo(function ScreenTitle({
  title,
}: {
  readonly title: string;
}): ReactElement {
  return <Stack.Screen options={{ title }} />;
});
