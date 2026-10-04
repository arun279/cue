import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { barOptions, useEpisodeSheetOptions } from "./ui/navigation-theme";
import { useColors } from "./ui/tokens";

export interface TabStackProps {
  readonly root: string;
  readonly title: string;
}

// The root is declared first: unstable_settings has no effect here, and the navigator starts on the first declared screen.
export function TabStack({ root, title }: TabStackProps): ReactElement {
  const colors = useColors();
  const sheet = useEpisodeSheetOptions();
  const detail = {
    headerTintColor: colors.accentInk,
    headerTitleStyle: { color: colors.fg },
  } as const;
  return (
    <Stack screenOptions={barOptions}>
      <Stack.Screen name={root} options={{ title }} />
      <Stack.Screen name="show/[showId]" options={{ ...detail, title: "Show" }} />
      <Stack.Screen name="movie/[movieId]" options={{ ...detail, title: "Movie" }} />
      <Stack.Screen name="show/[showId]/episode/[season]/[episode]" options={sheet} />
    </Stack>
  );
}
