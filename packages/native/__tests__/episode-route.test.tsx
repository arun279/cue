import { readdirSync } from "node:fs";
import { join } from "node:path";
import { router, Stack } from "expo-router";
import { act, renderRouter, screen } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { View } from "react-native";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

/**
 * The real route tree, read from `app/`, with every screen stubbed and every
 * layout but the root one real. Groups do not reach the URL, so two files can
 * answer the same href, and which one wins depends on the whole tree rather
 * than on the screen that pushes it.
 */
const appDir = join(__dirname, "../app");
const routes = Object.fromEntries(
  readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => {
      const name = file.replace(/\.tsx$/, "");
      if (name === "_layout") {
        return [name, (): ReactElement => <Stack screenOptions={{ headerShown: false }} />];
      }
      if (name.endsWith("_layout")) return [name, require(join(appDir, file))];
      return [name, (): ReactElement => <View testID={name} />];
    }),
);

const SHOW = "(tabs)/(up-next,library,calendar,search)/show/[showId]";
const EPISODE = `${SHOW}/episode/[season]/[episode]`;

it("stacks the episode sheet on the show it was opened from, and pops back to it", async () => {
  await renderRouter(routes, { initialUrl: "/" });
  await act(() => router.push("/show/8803"));
  await act(() => router.push("/show/8803/episode/2/8"));

  expect(screen.getByTestId(EPISODE)).toBeOnTheScreen();
  expect(screen.queryByTestId("(account)/show/[showId]/episode/[season]/[episode]")).toBeNull();

  await act(() => router.back());

  expect(screen.queryByTestId(EPISODE)).toBeNull();
  expect(screen.getByTestId(SHOW)).toBeOnTheScreen();
});
