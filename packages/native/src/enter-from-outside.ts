import { type Href, router, type useNavigationContainerRef } from "expo-router";

interface NavigatorState {
  readonly key?: string;
  readonly type?: string;
  readonly index?: number;
  readonly routes: readonly { readonly state?: NavigatorState }[];
}

function stacksAbove(state: NavigatorState | undefined): string[] {
  if (state?.key === undefined) return [];
  const index = state.index ?? 0;
  const popped = state.type === "stack" && index > 0;
  return [...(popped ? [state.key] : []), ...stacksAbove(state.routes[popped ? 0 : index]?.state)];
}

export function enterFromOutside(
  navigation: ReturnType<typeof useNavigationContainerRef>,
  href: Href,
): void {
  for (const key of stacksAbove(navigation.getRootState()))
    navigation.dispatch({ type: "POP_TO_TOP", target: key });
  router.navigate(href);
}
