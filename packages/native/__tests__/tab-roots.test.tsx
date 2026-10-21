import { act } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { type ReactElement, useEffect } from "react";
import { Text } from "react-native";

const TabsLayout = (require("../app/(tabs)/_layout") as typeof import("../app/(tabs)/_layout"))
  .default;

const mounts = new Map<string, number>();

function root(name: string): () => ReactElement {
  return function TabRootProbe(): ReactElement {
    useEffect(() => {
      mounts.set(name, (mounts.get(name) ?? 0) + 1);
    }, []);
    return <Text>{name}</Text>;
  };
}

const TABS = [
  ["/", "(up-next)", "index"],
  ["/library", "(library)", "library"],
  ["/calendar", "(calendar)", "calendar"],
  ["/search", "(search)", "search"],
] as const;

const group = (name: string) =>
  (require(`../app/(tabs)/${name}/_layout`) as { default: () => ReactElement }).default;

it("mounts each tab root once however often the tabs are switched", async () => {
  await renderRouter({
    "(tabs)/_layout": TabsLayout,
    ...Object.fromEntries(
      TABS.flatMap(([, tab, screen]) => [
        [`(tabs)/${tab}/_layout`, group(tab)],
        [`(tabs)/${tab}/${screen}`, root(screen)],
      ]),
    ),
    ...Object.fromEntries(
      ["show/[showId]", "movie/[movieId]", "show/[showId]/episode/[season]/[episode]"].map(
        (route) => [`(tabs)/(up-next,library,calendar,search)/${route}`, () => null],
      ),
    ),
  });

  for (let pass = 0; pass < 3; pass += 1) {
    for (const [path] of TABS) await act(async () => router.navigate(path));
  }

  expect(Object.fromEntries(mounts)).toEqual(
    Object.fromEntries(TABS.map(([, , screen]) => [screen, 1])),
  );
});
