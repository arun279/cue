/** @jest-environment node */

import { relative } from "node:path";
import ts from "typescript";
import { PRESENTATIONS } from "../src/presentation";
import { nativeSourceFiles } from "./support/native-sources";
import {
  appRoot,
  attributeOf,
  closureOf,
  DISMISS,
  descendants,
  edges,
  isRoot,
  NAVIGATE,
  nameIn,
  navigators,
  presentationOf,
  presentedModally,
  type Route,
  routes,
  SHEET_CLOSE,
  screenName,
  screensOf,
  sourceOf,
  tagOf,
} from "./support/navigation-edges";

/**
 * The parts of the navigation graph that are declarations rather than behavior:
 * every navigation is one this suite can read and replay, presentations come from
 * one table, every modal root and sheet carries its own dismiss, and every pushed
 * screen keeps its header. Where a navigation lands, and whether the platform back
 * returns from it, is checked against the real router in navigation-round-trips.
 * A bad href already fails `pnpm typecheck`, since typed routes are on.
 */

it("lists the href of every navigation call so it can be replayed", () => {
  expect(edges.filter(({ call }) => call.paths === undefined).map(({ call }) => call.at)).toEqual(
    [],
  );
  expect(edges.length).toBeGreaterThan(0);
});

it("gives every modal root a dismiss control on both platforms", () => {
  const modals = navigators.filter(presentedModally);
  const missing = modals.flatMap((navigator) => {
    const root = screensOf(navigator).find(
      (node) => screenName(navigator, node) === navigator.root,
    );
    const parts = root ? descendants(ts.isJsxOpeningElement(root) ? root.parent : root) : [];
    const ios = parts.some(
      (node) =>
        tagOf(node) === "Stack.Toolbar.Button" &&
        descendants(attributeOf(node, "onPress") ?? node).some(
          (call) =>
            ts.isPropertyAccessExpression(call) &&
            call.expression.getText() === "router" &&
            DISMISS.has(call.name.text),
        ),
    );
    const android = parts.some(
      (node) => ts.isPropertyAssignment(node) && node.name.getText() === "headerBackIcon",
    );
    return [
      ...(ios ? [] : [`${navigator.dir} (iOS)`]),
      ...(android ? [] : [`${navigator.dir} (Android)`]),
    ];
  });

  expect(modals.length).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});

it("gives every sheet a visible close beside its swipe and system back", () => {
  const sheets = routes.filter((route) => presentationOf(nameIn(route)) === "formSheet");

  expect(sheets.length).toBeGreaterThan(0);
  expect(
    sheets.filter((route) => !closureOf(route.file).includes(SHEET_CLOSE)).map(({ id }) => id),
  ).toEqual([]);
});

it("presents routes only through the one table outside entries also read", () => {
  const declared = new Set(
    navigators.flatMap((navigator) =>
      screensOf(navigator).map((screen) => screenName(navigator, screen)),
    ),
  );
  const inline = nativeSourceFiles().flatMap((file) =>
    descendants(sourceOf(file))
      .filter(
        (node) =>
          ts.isPropertyAssignment(node) &&
          node.name.getText() === "presentation" &&
          ts.isStringLiteralLike(node.initializer),
      )
      .map((node) => `${relative(appRoot, file)}:${node.getText()}`),
  );

  expect(Object.keys(PRESENTATIONS).filter((name) => !declared.has(name))).toEqual([]);
  expect(inline.filter((site) => !site.startsWith("../src/presentation.ts"))).toEqual([]);
});

const NAVIGATION_HOOKS = new Set(["useRouter", "useNavigation", "useNavigationContainerRef"]);
const NAVIGATING = new Set([
  ...NAVIGATE,
  ...DISMISS,
  "dispatch",
  "goBack",
  "pop",
  "popTo",
  "popToTop",
  "reset",
  "resetRoot",
]);

/** Navigation this graph cannot read: a router under another name, a navigator driven directly, or Cue opening its own scheme. */
function unreadNavigation(file: string): string[] {
  const nodes = descendants(sourceOf(file));
  const at = (node: ts.Node) =>
    `${relative(appRoot, file)}:${sourceOf(file).getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const hooked = nodes.filter(
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && NAVIGATION_HOOKS.has(node.expression.getText()),
  );
  const renamed = hooked
    .filter((call) => call.expression.getText() === "useRouter")
    .filter(
      (call) => !ts.isVariableDeclaration(call.parent) || call.parent.name.getText() !== "router",
    )
    .map((call) => `${at(call)} useRouter() not bound to router`);
  const drivers = new Set(
    hooked.flatMap((call) =>
      call.expression.getText() !== "useRouter" && ts.isVariableDeclaration(call.parent)
        ? [call.parent.name.getText()]
        : [],
    ),
  );
  const driven = nodes
    .filter(
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        drivers.has(node.expression.expression.getText()) &&
        NAVIGATING.has(node.expression.name.text) &&
        !/type:\s*"POP"/.test(node.arguments[0]?.getText() ?? ""),
    )
    .map((call) => `${at(call)} ${call.expression.getText()}`);
  const ownScheme = nodes
    .filter(
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) &&
        /openURL$/.test(node.expression.getText()) &&
        /["`]cue:/.test(node.arguments[0]?.getText() ?? ""),
    )
    .map((call) => `${at(call)} ${call.expression.getText()} to cue://`);
  return [...renamed, ...driven, ...ownScheme];
}

it("reads every navigation in the app: routers are named router, and navigators are not driven directly", () => {
  expect(nativeSourceFiles().flatMap(unreadNavigation)).toEqual([]);
});

/** headerShown as declared on the screen, then in the route, then for the whole navigator. */
function headerShown(route: Route): boolean {
  const flag = (text: string | undefined): string | undefined =>
    text?.match(/headerShown:\s*(true|false)/)?.[1];
  const screen = screensOf(route.navigator).find(
    (node) => screenName(route.navigator, node) === nameIn(route),
  );
  const inRoute = closureOf(route.file)
    .flatMap((file) => descendants(sourceOf(file)))
    .filter((node) => tagOf(node) === "Stack.Screen" && attributeOf(node, "name") === undefined)
    .map((node) => flag(attributeOf(node, "options")?.getText()))
    .find((value) => value !== undefined);
  const navigator = closureOf(route.navigator.file)
    .flatMap((file) => descendants(sourceOf(file)))
    .map((node) =>
      tagOf(node) === "Stack" ? flag(attributeOf(node, "screenOptions")?.getText()) : undefined,
    )
    .find((value) => value !== undefined);
  return (
    (flag(screen && attributeOf(screen, "options")?.getText()) ?? inRoute ?? navigator) !== "false"
  );
}

it("keeps the header, and so the back button, on every screen pushed onto a stack", () => {
  const pushed = routes.filter(
    (route) =>
      !route.navigator.tabs && !isRoot(route) && presentationOf(nameIn(route)) !== "formSheet",
  );

  expect(pushed.length).toBeGreaterThan(0);
  expect(pushed.filter((route) => !headerShown(route)).map(({ id }) => id)).toEqual([]);
});
