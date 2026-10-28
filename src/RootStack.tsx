import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { useHeldNavigation } from "./enter-from-outside";
import { PRESENTATIONS } from "./presentation";
import {
  useEpisodeSheetOptions,
  useMonthJumpSheetOptions,
  useOpaqueScreen,
} from "./ui/navigation-theme";

export function RootStack(): ReactElement {
  useHeldNavigation();
  const sheet = useEpisodeSheetOptions();
  const monthJump = useMonthJumpSheetOptions();
  const opaque = useOpaqueScreen();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="(account)"
        options={{ presentation: PRESENTATIONS["(account)"], ...opaque }}
      />
      <Stack.Screen name="show/[showId]/episode/[season]/[episode]" options={sheet} />
      <Stack.Screen name="history-jump" options={monthJump} />
      <Stack.Screen name="+not-found" options={{ headerShown: true, ...opaque }} />
    </Stack>
  );
}
