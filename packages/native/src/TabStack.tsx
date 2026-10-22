import { Stack, useIsFocused } from "expo-router";
import { type ReactElement, useState } from "react";
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

function useVisited(): boolean {
  const focused = useIsFocused();
  const [visited, setVisited] = useState(focused);
  if (focused && !visited) setVisited(true);
  return visited || focused;
}

// The root is declared first: unstable_settings has no effect here, and the navigator starts on the first declared screen.
export function TabStack({ root, title }: TabStackProps): ReactElement | null {
  const visited = useVisited();
  const colors = useColors();
  const opaque = useOpaqueScreen();
  if (!visited) return null;
  const detail = {
    headerTintColor: colors[HEADER_TINT],
    headerTitleStyle: { color: colors.fg },
  } as const;
  return (
    <Stack screenOptions={{ ...barOptions, ...opaque, freezeOnBlur: true }}>
      <Stack.Screen name={root} options={{ title, ...TRANSPARENT_SCREEN }} />
      <Stack.Screen name="show/[showId]" options={{ ...detail, title: "Show" }} />
      <Stack.Screen name="movie/[movieId]" options={{ ...detail, title: "Movie" }} />
      <Stack.Screen name="history" options={{ title: "History" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
