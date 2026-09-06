import { Stack } from "expo-router";
import type { ReactElement } from "react";

export interface TabStackProps {
  /** The tab's own root route, declared first so it is the stack's initial one. */
  readonly root: string;
  readonly title: string;
}

/**
 * One native stack per tab, written once and rendered by each tab group's own
 * `_layout.tsx` with its own root screen.
 *
 * The detail routes it hosts are written once too, in the sibling
 * `(up-next,library,calendar,search)` directory: expo-router's array-group
 * syntax duplicates that directory's files into each named group, so show
 * detail, movie detail and the episode sheet are reachable from every tab, the
 * tab bar stays visible on push, and each tab keeps its own back stack. That is
 * what a `UINavigationController` inside a tab does natively, and it is the
 * per-tab duplication this avoids.
 *
 * The root screen is declared first, and that ordering is load-bearing rather
 * than tidy. `unstable_settings`, the documented way to name a group's initial
 * route, has no effect here: with the shared routes declared first, pressing a
 * tab opened `show/[showId]` with no id in every tab. Declaration order is what
 * the navigator actually falls back to, so the tab's own root is declared first
 * and the shared routes after it.
 */
export function TabStack({ root, title }: TabStackProps): ReactElement {
  return (
    <Stack>
      <Stack.Screen name={root} options={{ title }} />
      <Stack.Screen name="show/[showId]" options={{ title: "Show" }} />
      <Stack.Screen name="movie/[movieId]" options={{ title: "Movie" }} />
      {/* The episode is a child of the show route so a cold deep link paints the
          show underneath and dismissing is one pop. UIKit owns the detents, the
          grabber and the physics; the numbers are the web app's own 65 and 92
          per cent. */}
      <Stack.Screen
        name="show/[showId]/episode/[season]/[episode]"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [0.65, 0.92],
          sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true,
          sheetCornerRadius: 20,
          title: "Episode",
        }}
      />
    </Stack>
  );
}
