import { type Href, router, useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";
import { isPresented } from "./presentation";

type Navigation = ReturnType<typeof useNavigationContainerRef>;

interface NavigatorState {
  readonly key?: string;
  readonly type?: string;
  readonly index?: number;
  readonly routes: readonly { readonly name: string; readonly state?: NavigatorState }[];
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

interface Pop {
  readonly key: string;
  readonly count: number;
}

function presentedPops(state: NavigatorState | undefined): Pop[] {
  if (state?.key === undefined) return [];
  const index = state.index ?? 0;
  const below = state.type === "stack" ? topCardIndex(state, index) : index;
  const pops = index > below ? [{ key: state.key, count: index - below }] : [];
  return [...pops, ...presentedPops(state.routes[below]?.state)];
}

function topCardIndex(state: NavigatorState, index: number): number {
  let below = index;
  while (below > 0 && isPresented(state.routes[below]?.name ?? "")) below -= 1;
  return below;
}

export function dismissPresented(): Promise<void> {
  const navigation = held;
  const pops = navigation?.isReady() ? presentedPops(navigation.getRootState()) : [];
  if (navigation === undefined || pops.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = navigation.addListener("state", () => {
      unsubscribe();
      resolve();
    });
    for (const { key, count } of pops)
      navigation.dispatch({ type: "POP", payload: { count }, target: key });
  });
}

export async function enterFromOutside(href: Href): Promise<void> {
  await dismissPresented();
  router.navigate(href);
}
