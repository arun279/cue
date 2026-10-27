import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Href, router, Tabs } from "expo-router";
import { act, renderRouter } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { View } from "react-native";
import { RootStack } from "../src/RootStack";
import { QueryProvider } from "./support/query-provider";

jest.mock("@expo/ui/jetpack-compose", () => require("./support/native-ui").composeModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

/**
 * Every route file under app/, over the app's own tab and account layouts, with
 * each screen standing in as an empty view and JavaScript tabs standing in for the
 * native tabs, which this runner cannot draw.
 */
const appDir = join(__dirname, "../app");
const Screen = (): ReactElement => <View />;
const app = {
  ...Object.fromEntries(
    readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => [
        file.replace(/\.tsx?$/, ""),
        /\/_layout|\+native-intent/.test(file) ? require(join(appDir, file)) : Screen,
      ]),
  ),
  _layout: RootStack,
  "(tabs)/_layout": (): ReactElement => <Tabs screenOptions={{ headerShown: false }} />,
};

async function openAt(url: string, ...pushes: Href[]): Promise<() => string[]> {
  const view = renderRouter(app, { initialUrl: url, wrapper: QueryProvider });
  await view;
  for (const href of pushes) await go(() => router.push(href));
  return () => view.getSegments();
}

async function go(navigate: () => void): Promise<void> {
  await act(async () => navigate());
  for (const _ of [1, 2, 3]) await act(async () => {});
}

const TABS = [
  ["(up-next)", "/", ["(tabs)", "(up-next)"]],
  ["(library)", "/library", ["(tabs)", "(library)", "library"]],
  ["(calendar)", "/calendar", ["(tabs)", "(calendar)", "calendar"]],
  ["(search)", "/search", ["(tabs)", "(search)", "search"]],
] as const;

const PUSHED = [
  ["/history", ["history"]],
  ["/settings", ["settings"]],
  ["/show/6", ["show", "[showId]"]],
  ["/movie/6", ["movie", "[movieId]"]],
] as const;

const SHEETS = [
  ["the month jump", "/history", "/history-jump", ["history-jump"]],
  [
    "an episode",
    "/show/6",
    "/show/6/episode/1/2",
    ["show", "[showId]", "episode", "[season]", "[episode]"],
  ],
] as const;

describe.each(TABS)("the %s tab", (tab, url, root) => {
  it.each(PUSHED)("pushes %s onto the tab, and back returns to its root", async (href, landed) => {
    const segments = await openAt(url);

    await go(() => router.push(href));
    expect(segments()).toEqual(["(tabs)", tab, ...landed]);

    await go(() => router.back());
    expect(segments()).toEqual(root);
  });

  it.each(
    SHEETS,
  )("presents %s over the screen it opens from, and back returns there", async (_, from, href, landed) => {
    const segments = await openAt(url, from);
    const beneath = segments();

    await go(() => router.push(href));
    expect(segments()).toEqual(landed);

    await go(() => router.back());
    expect(segments()).toEqual(beneath);
  });
});

describe("the account modal", () => {
  const PROFILE = ["(account)", "profile"];

  it.each(PUSHED)("pushes %s over Profile, and back returns to Profile", async (href, landed) => {
    const segments = await openAt("/", "/profile");
    expect(segments()).toEqual(PROFILE);

    await go(() => router.push(href));
    expect(segments()).toEqual(["(account)", ...landed]);

    await go(() => router.back());
    expect(segments()).toEqual(PROFILE);
  });

  it("dismisses to the tab beneath it", async () => {
    const segments = await openAt("/library", "/profile");

    await go(() => router.dismissAll());

    expect(segments()).toEqual(["(tabs)", "(library)", "library"]);
  });

  it("dismisses to Search from its empty state", async () => {
    const segments = await openAt("/", "/profile");

    await go(() => router.dismissTo("/search"));

    expect(segments()).toEqual(["(tabs)", "(search)", "search"]);
  });
});

it("pages an episode in place, so back still returns to the show", async () => {
  const segments = await openAt("/", "/show/6", "/show/6/episode/1/2");

  await go(() => router.replace("/show/6/episode/1/3"));
  expect(segments()).toEqual(["show", "[showId]", "episode", "[season]", "[episode]"]);

  await go(() => router.back());
  expect(segments()).toEqual(["(tabs)", "(up-next)", "show", "[showId]"]);
});

it.each([
  ["/library", ["(tabs)", "(library)", "library"]],
  ["/calendar", ["(tabs)", "(calendar)", "calendar"]],
  ["/search", ["(tabs)", "(search)", "search"]],
] as const)("switches to the tab at %s from an Up Next button", async (href, landed) => {
  const segments = await openAt("/");

  await go(() => router.push(href));

  expect(segments()).toEqual(landed);
});
