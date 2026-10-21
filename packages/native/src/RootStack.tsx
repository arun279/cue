import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { useHeldNavigation } from "./enter-from-outside";
import { PRESENTATIONS } from "./presentation";

export function RootStack(): ReactElement {
  useHeldNavigation();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(account)" options={{ presentation: PRESENTATIONS["(account)"] }} />
      <Stack.Screen name="+not-found" options={{ headerShown: true }} />
    </Stack>
  );
}
