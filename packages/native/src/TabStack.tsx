import { useIsFetching } from "@tanstack/react-query";
import { Stack, useIsFocused, useNavigation, useRoute } from "expo-router";
import {
  type NavigationProp,
  type ParamListBase,
  type TabNavigationState,
  useNavigationState,
} from "expo-router/react-navigation";
import { type ReactElement, useEffect, useState } from "react";
import {
  barOptions,
  HEADER_TINT,
  TRANSPARENT_SCREEN,
  useOpaqueScreen,
} from "./ui/navigation-theme";
import { useColors } from "./ui/tokens";

type TabsNavigation = NavigationProp<
  ParamListBase,
  string,
  string | undefined,
  TabNavigationState<ParamListBase>
>;

export interface TabStackProps {
  readonly root: string;
  readonly title: string;
}

function useMounted(focused: boolean): boolean {
  const { key } = useRoute();
  const navigation = useNavigation<TabsNavigation>();
  const preloaded = useNavigationState(() =>
    navigation.getState().preloadedRouteKeys.includes(key),
  );
  const [mounted, setMounted] = useState(focused || preloaded);
  if ((focused || preloaded) && !mounted) setMounted(true);
  return mounted;
}

function usePreloadWhenSettled(focused: boolean): void {
  const navigation = useNavigation<TabsNavigation>();
  const settled = useIsFetching() === 0;
  useEffect(() => {
    if (!focused || !settled) return;
    const idle = requestIdleCallback(() => {
      const { routes, preloadedRouteKeys, index } = navigation.getState();
      for (const [position, route] of routes.entries()) {
        if (
          position !== index &&
          route.state === undefined &&
          !preloadedRouteKeys.includes(route.key)
        )
          navigation.preload(route.name);
      }
    });
    return () => cancelIdleCallback(idle);
  }, [focused, settled, navigation]);
}

// The root is declared first: unstable_settings has no effect here, and the navigator starts on the first declared screen.
export function TabStack({ root, title }: TabStackProps): ReactElement | null {
  const focused = useIsFocused();
  const mounted = useMounted(focused);
  usePreloadWhenSettled(focused);
  const colors = useColors();
  const opaque = useOpaqueScreen();
  if (!mounted) return null;
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
