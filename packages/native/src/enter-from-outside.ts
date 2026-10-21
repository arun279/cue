import { type Href, router, useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";

type Navigation = ReturnType<typeof useNavigationContainerRef>;

interface NavigatorState {
  readonly key?: string;
  readonly type?: string;
  readonly index?: number;
  readonly routes: readonly { readonly state?: NavigatorState }[];
}

let held: Navigation | undefined;

export function useHeldNavigation(): void {
  const navigation = useNavigationContainerRef();
  useEffect(() => {
    held = navigation;
    return () => {
      held = undefined;
    };
  }, [navigation]);
}

function stacksAbove(state: NavigatorState | undefined): string[] {
  if (state?.key === undefined) return [];
  const index = state.index ?? 0;
  const popped = state.type === "stack" && index > 0;
  return [...(popped ? [state.key] : []), ...stacksAbove(state.routes[popped ? 0 : index]?.state)];
}

export function dismissPresented(): Promise<void> {
  const navigation = held;
  const keys = navigation?.isReady() ? stacksAbove(navigation.getRootState()) : [];
  if (navigation === undefined || keys.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = navigation.addListener("state", () => {
      unsubscribe();
      resolve();
    });
    for (const key of keys) navigation.dispatch({ type: "POP_TO_TOP", target: key });
  });
}

export async function enterFromOutside(href: Href): Promise<void> {
  await dismissPresented();
  router.navigate(href);
}
