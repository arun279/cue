import { relative } from "node:path";
import { type Href, router, Tabs } from "expo-router";
import { act, renderRouter } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { View } from "react-native";
import { isPresented } from "../src/presentation";
import { RootStack } from "../src/RootStack";
import {
  appRoot,
  type Call,
  concreteLinks,
  type Edge,
  edges,
  isGroup,
  isRoot,
  nameIn,
  navigators,
  parentOf,
  presentedModally,
  type Route,
  routeAt,
  routes,
} from "./support/navigation-edges";
import { QueryProvider } from "./support/query-provider";

jest.mock("@expo/ui/jetpack-compose", () => require("./support/native-ui").composeModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

/**
 * Replays every navigation the source makes, from the screen that makes it, through
 * the real router over the real app/ layouts, with each screen standing in as an
 * empty view and JavaScript tabs standing in for the native tabs. After each one the
 * platform back must return to where it started; another stack must open at its
 * root, where its dismiss control is; a jump to another tab must leave the tab it
 * left as it was; a replace must stay in its stack. Which screen a path reaches is
 * the real router's answer, not a copy of its matching.
 */

const Screen = (): ReactElement => <View />;
const keyOf = (file: string) => relative(appRoot, file).replace(/\.tsx$/, "");
const app = {
  ...Object.fromEntries(routes.map(({ file }) => [keyOf(file), Screen])),
  ...Object.fromEntries(
    navigators
      .filter(({ dir, tabs }) => dir !== "" && !tabs)
      .map(({ file }) => [keyOf(file), require(file)]),
  ),
  "+native-intent": require("../app/+native-intent"),
  _layout: RootStack,
  "(tabs)/_layout": (): ReactElement => <Tabs screenOptions={{ headerShown: false }} />,
};

const isParam = (segment: string) => /^\[.+\]$/.test(segment);
const pathOf = (route: Route, groups: boolean) =>
  `/${route.segments
    .filter((segment) => segment !== "index" && (groups || !isGroup(segment)))
    .map((segment) => (isParam(segment) ? "6" : segment))
    .join("/")}`;
const inTab = (route: Route) => parentOf(route.navigator)?.tabs === true;
const tabRoot = (route: Route) => isRoot(route) && inTab(route);
const rootOf = (route: Route) =>
  routes.find((candidate) => candidate.navigator === route.navigator && isRoot(candidate));

/** How a user reaches a route: open its tab, or Profile, then push it. */
function stepsTo(route: Route): { readonly url: string; readonly pushes: readonly string[] } {
  if (route.id === "+not-found") return { url: "/", pushes: ["/nowhere"] };
  if (inTab(route)) {
    const root = rootOf(route);
    return {
      url: root ? pathOf(root, false) : "/",
      pushes: isRoot(route) ? [] : [pathOf(route, true)],
    };
  }
  return { url: "/", pushes: ["/profile", ...(isRoot(route) ? [] : [pathOf(route, true)])] };
}

interface RouteNode {
  readonly name: string;
  readonly state?: { readonly routes: readonly RouteNode[] };
}

function stackOf(nodes: readonly RouteNode[] | undefined, name: string): string[] | undefined {
  for (const node of nodes ?? []) {
    if (node.name === name) return node.state?.routes.map((child) => child.name);
    const found = stackOf(node.state?.routes, name);
    if (found) return found;
  }
  return undefined;
}

const trips = edges
  .flatMap((edge) =>
    (edge.call.paths ?? []).flatMap((path) =>
      concreteLinks(path).map(
        (href) => [`${edge.from.id} ${edge.call.method} ${href}`, edge, href] as const,
      ),
    ),
  )
  .filter(([key], index, all) => all.findIndex(([other]) => other === key) === index);

const reached = new Set<string>();

/** Each href here is read from the source as a string; the typecheck already proves it is a route. */
const push = (href: string) => act(() => router.push(href as Href));

/** Replays a navigation the way the source makes it: through the router, or through the
 * helper the source calls, which may wait for a render before it navigates. */
const ROUTER: Readonly<Record<string, (href: Href) => void>> = {
  push: (href) => router.push(href),
  navigate: (href) => router.navigate(href),
  dismissTo: (href) => router.dismissTo(href),
  replace: (href) => router.replace(href),
};

async function replay(call: Call, href: string): Promise<void> {
  const navigate: (href: Href) => unknown = call.module
    ? require(call.module)[call.method]
    : ROUTER[call.method];
  await act(async () => {
    void navigate(href as Href);
  });
  for (const _ of [1, 2, 3]) await act(async () => {});
}

interface Opened {
  pathname(): string;
  segments(): string[];
  stack(): string[];
  presented(): boolean;
}

/** Opens the route the way a user reaches it. renderRouter's result is a promise, and
 * the router's location readers hang on the object it returned. */
async function openAt(route: Route): Promise<Opened> {
  const steps = stepsTo(route);
  const view = renderRouter(app, { initialUrl: steps.url, wrapper: QueryProvider });
  await view;
  for (const step of steps.pushes) await push(step);
  expect(routeAt(view.getSegments())?.id).toBe(route.id);
  const tab = route.navigator.dir.split("/").at(-1) ?? "";
  return {
    pathname: () => view.getPathname(),
    segments: () => view.getSegments(),
    stack: () => stackOf(view.getRouterState()?.routes, tab) ?? [nameIn(route)],
    presented: () => stackOf(view.getRouterState()?.routes, "(account)") !== undefined,
  };
}

/** Another stack opens at its root, where its dismiss control is. */
function expectOpenedAtRoot(from: Route, landed: Route): void {
  if (landed.navigator === from.navigator || landed.navigator.dir === "") return;
  expect(isRoot(landed) && presentedModally(landed.navigator)).toBe(true);
}

/** A jump to another tab keeps the screens pushed in the tab it leaves, and closes a modal it starts in. */
function expectTabLeft(opened: Opened, from: Route, before: string[]): void {
  if (!inTab(from)) {
    expect(opened.presented()).toBe(false);
    return;
  }
  expect(opened.stack()).toEqual(before.filter((name) => !isPresented(name)));
}

/**
 * Another stack opens at its root; a replace or a dismissal stays in its stack without
 * growing it; a return to an earlier screen of the same stack leaves nothing to undo;
 * anything else is undone by the platform back.
 */
async function expectUndone(opened: Opened, from: Route, method: string, before: string[]) {
  const landed = routeAt(opened.segments());
  expect(landed).toBeDefined();
  if (landed === undefined) return;
  reached.add(landed.id);
  if (tabRoot(landed) && landed.navigator !== from.navigator)
    return expectTabLeft(opened, from, before);
  expectOpenedAtRoot(from, landed);
  if (method === "replace" || method === "dismissTo") {
    expect(landed.navigator.dir).toBe(from.navigator.dir);
    expect(opened.stack().length).toBeLessThanOrEqual(before.length);
    return;
  }
  if (landed.navigator === from.navigator && opened.stack().length < before.length) return;
  await act(() => router.back());
  expect(routeAt(opened.segments())?.id).toBe(from.id);
}

it.each(trips)("%s returns where it started", async (_, { from, call }: Edge, href: string) => {
  const opened = await openAt(from);
  const before = opened.stack();
  const start = opened.pathname();

  await replay(call, href);

  expect(opened.pathname()).not.toBe(start);
  await expectUndone(opened, from, call.method, before);
});

it("reaches every route through a navigation the app makes", () => {
  const entered = (route: Route) => route.id === "+not-found" || tabRoot(route);
  expect(
    routes.filter((route) => !reached.has(route.id) && !entered(route)).map(({ id }) => id),
  ).toEqual([]);
});
