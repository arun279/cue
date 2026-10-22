import { Stack } from "expo-router";
import type { ReactElement } from "react";
import {
  barOptions,
  HEADER_TINT,
  TRANSPARENT_SCREEN,
  useOpaqueScreen,
} from "./ui/navigation-theme";
import { useColors } from "./ui/tokens";

export interface TabStackProps {
  readonly root: string;
  readonly title: string;
}

// The root is declared first: unstable_settings has no effect here, and the navigator starts on the first declared screen.
export function TabStack({ root, title }: TabStackProps): ReactElement {
  const colors = useColors();
  const opaque = useOpaqueScreen();
  const detail = {
    headerTintColor: colors[HEADER_TINT],
    headerTitleStyle: { color: colors.fg },
  } as const;
  return (
    <Stack screenOptions={{ ...barOptions, ...opaque }}>
      <Stack.Screen name={root} options={{ title, ...TRANSPARENT_SCREEN }} />
      <Stack.Screen name="show/[showId]" options={{ ...detail, title: "Show" }} />
      <Stack.Screen name="movie/[movieId]" options={{ ...detail, title: "Movie" }} />
      <Stack.Screen name="history" options={{ title: "History" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
