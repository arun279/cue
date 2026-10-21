/** @jest-environment node */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { PRESENTATIONS } from "../src/presentation";
import { nativeSourceFiles } from "./support/native-sources";

/**
 * Builds the navigation graph from the route files under app/ and the navigation
 * calls their modules make, then checks it against platform rules rather than a
 * snapshot of today's edges: every route is reachable, every navigation lands
 * where the platform back returns from it, and every modal presentation carries
 * its own dismiss. A target resolves the way expo-router resolves a shared route:
 * the match sharing the most groups with the caller wins, then the first
 * alphabetically. The router itself enters +not-found, for a link nothing matches.
 */

const appRoot = join(__dirname, "../app");
const SHEET_CLOSE = join(__dirname, "../src/ui/SheetClose.tsx");
const NAVIGATE = new Set(["push", "navigate", "dismissTo"]);
const REPLACE = new Set(["replace"]);
const DISMISS = new Set(["back", "dismiss", "dismissAll"]);
const MODAL = new Set(["modal", "fullScreenModal", "pageSheet", "formSheet"]);
const isGroup = (segment: string): boolean => segment.startsWith("(");

interface Navigator {
  readonly dir: string;
  readonly file: string;
  readonly tabs: boolean;
  readonly root: string | undefined;
}

interface Route {
  readonly id: string;
  readonly segments: readonly string[];
  readonly file: string;
  readonly navigator: Navigator;
}

const parsed = new Map<string, ts.SourceFile>();
function sourceOf(file: string): ts.SourceFile {
  const cached = parsed.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  parsed.set(file, source);
  return source;
}

function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function resolveImport(from: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) return [];
  const base = resolve(dirname(from), specifier);
  return [".tsx", ".ts", ".android.tsx", ".ios.tsx", "/index.tsx", "/index.ts"]
    .map((suffix) => base + suffix)
    .filter(existsSync);
}

function importsOf(file: string): string[] {
  return sourceOf(file).statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? resolveImport(file, statement.moduleSpecifier.text)
      : [],
  );
}

function closureOf(file: string): string[] {
  const seen = new Set([file]);
  for (const next of seen) for (const imported of importsOf(next)) seen.add(imported);
  return [...seen];
}

function expand(segments: readonly string[]): string[][] {
  return segments.reduce<string[][]>(
    (paths, segment) => {
      const options = /^\(.+,.+\)$/.test(segment)
        ? segment
            .slice(1, -1)
            .split(",")
            .map((name) => `(${name})`)
        : [segment];
      return paths.flatMap((path) => options.map((option) => [...path, option]));
    },
    [[]],
  );
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name))
      : entry.name.endsWith(".tsx")
        ? [join(dir, entry.name)]
        : [],
  );
}

function tagOf(node: ts.Node): string | undefined {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
    ? node.tagName.getText()
    : undefined;
}

function attributeOf(node: ts.Node, name: string): ts.Expression | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return undefined;
  const found = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  )?.initializer;
  if (found === undefined) return undefined;
  return ts.isJsxExpression(found) ? found.expression : found;
}

const literalOf = (expression: ts.Expression | undefined): string | undefined =>
  expression !== undefined && ts.isStringLiteralLike(expression) ? expression.text : undefined;

function screensOf(navigator: Navigator): ts.Node[] {
  return closureOf(navigator.file)
    .flatMap((file) => descendants(sourceOf(file)))
    .filter((node) => tagOf(node) === "Stack.Screen" && attributeOf(node, "name") !== undefined);
}

function screenName(navigator: Navigator, screen: ts.Node): string | undefined {
  const name = attributeOf(screen, "name");
  if (name === undefined) return undefined;
  if (literalOf(name) !== undefined) return literalOf(name);
  const prop = name.getText();
  return descendants(sourceOf(navigator.file))
    .map((node) => literalOf(attributeOf(node, prop)))
    .find((value) => value !== undefined);
}

function navigatorAt(dir: string, file: string): Navigator {
  const source = sourceOf(file);
  const initial = source.text.match(/initialRouteName:\s*"([^"]+)"/)?.[1];
  const partial: Navigator = {
    dir,
    file,
    tabs: source.text.includes("<NativeTabs"),
    root: initial,
  };
  const [first] = screensOf(partial);
  return { ...partial, root: initial ?? (first && screenName(partial, first)) };
}

const navigators = filesUnder(appRoot)
  .filter((file) => file.endsWith("/_layout.tsx"))
  .flatMap((file) => {
    const dir = relative(appRoot, dirname(file));
    return expand(dir === "" ? [] : dir.split("/")).map((segments) =>
      navigatorAt(segments.join("/"), file),
    );
  });

const navigatorOf = (path: string): Navigator =>
  navigators
    .filter((navigator) => navigator.dir === "" || `${path}/`.startsWith(`${navigator.dir}/`))
    .reduce((deepest, navigator) =>
      navigator.dir.length > deepest.dir.length ? navigator : deepest,
    );

const routes: Route[] = filesUnder(appRoot)
  .filter((file) => !file.endsWith("/_layout.tsx"))
  .flatMap((file) =>
    expand(
      relative(appRoot, file)
        .replace(/\.tsx$/, "")
        .split("/"),
    ).map((segments) => {
      const id = segments.join("/");
      return { id, segments, file, navigator: navigatorOf(id) };
    }),
  );

const nameIn = (route: Route): string =>
  route.navigator.dir === "" ? route.id : route.id.slice(route.navigator.dir.length + 1);
const parentOf = (navigator: Navigator): Navigator | undefined =>
  navigator.dir === "" ? undefined : navigatorOf(navigator.dir.split("/").slice(0, -1).join("/"));
const isRoot = (route: Route): boolean => route.navigator.root === nameIn(route);

/** A function or constant by name among the modules a file reaches. */
function declarationIn(file: string, name: string): ts.Node | undefined {
  return closureOf(file)
    .flatMap((reached) => descendants(sourceOf(reached)))
    .find(
      (node) =>
        (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
        node.name?.getText() === name,
    );
}

function returnedBy(node: ts.Node): ts.Expression[] {
  const value = ts.isVariableDeclaration(node) ? node.initializer : node;
  if (value === undefined) return [];
  if (ts.isArrowFunction(value) && !ts.isBlock(value.body)) return [value.body];
  if (ts.isArrowFunction(value) || ts.isFunctionDeclaration(value))
    return descendants(value).flatMap((child) =>
      ts.isReturnStatement(child) && child.expression ? [child.expression] : [],
    );
  return ts.isExpression(value) ? [value] : [];
}

function pathnameOf(expression: ts.ObjectLiteralExpression): ts.Expression | undefined {
  return expression.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === "pathname",
  )?.initializer;
}

function allOrNothing(results: readonly (string[] | undefined)[]): string[] | undefined {
  return results.every((result) => result !== undefined) ? results.flat() : undefined;
}

/** Each path an href expression can evaluate to, with `*` for an interpolated segment. */
function pathsIn(file: string, expression: ts.Expression): string[] | undefined {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression))
    return [
      expression.head.text +
        expression.templateSpans.map((span) => `*${span.literal.text}`).join(""),
    ];
  if (ts.isConditionalExpression(expression))
    return allOrNothing([pathsIn(file, expression.whenTrue), pathsIn(file, expression.whenFalse)]);
  if (ts.isObjectLiteralExpression(expression)) {
    const pathname = pathnameOf(expression);
    return pathname && pathsIn(file, pathname);
  }
  const callee = ts.isCallExpression(expression) ? expression.expression : expression;
  const declared = ts.isIdentifier(callee) ? declarationIn(file, callee.text) : undefined;
  return (
    declared &&
    allOrNothing(
      returnedBy(declared).map((value) => pathsIn(declared.getSourceFile().fileName, value)),
    )
  );
}

interface Call {
  readonly at: string;
  readonly replaces: boolean;
  readonly paths: readonly string[] | undefined;
}

function callsIn(file: string): Call[] {
  const source = sourceOf(file);
  return descendants(source).flatMap((node) => {
    const at = `${relative(appRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const tag = tagOf(node);
    const href = tag === "Link" || tag === "Redirect" ? attributeOf(node, "href") : undefined;
    if (href) return [{ at, replaces: tag === "Redirect", paths: pathsIn(file, href) }];
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.expression.getText() !== "router" ||
      node.arguments[0] === undefined
    )
      return [];
    const method = node.expression.name.text;
    return NAVIGATE.has(method) || REPLACE.has(method)
      ? [{ at, replaces: REPLACE.has(method), paths: pathsIn(file, node.arguments[0]) }]
      : [];
  });
}

function matches(path: string, route: Route): boolean {
  const parts = path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  const groups = route.segments.filter(isGroup);
  const names = route.segments.filter((segment) => !isGroup(segment));
  if (names.at(-1) === "index") names.pop();
  const wanted = parts.filter((part) => !isGroup(part));
  return (
    parts.filter(isGroup).every((group) => groups.includes(group)) &&
    wanted.length === names.length &&
    wanted.every(
      (part, index) => part === "*" || names[index] === part || /^\[.+\]$/.test(names[index] ?? ""),
    )
  );
}

const shared = (caller: Route, route: Route): number =>
  caller.segments.filter((segment, index) => isGroup(segment) && route.segments[index] === segment)
    .length;

/** One route per distinct screen the path can reach, picked as expo-router picks it. */
function targetsOf(caller: Route, path: string): Route[] {
  const byScreen = new Map<string, Route>();
  for (const route of routes.filter((candidate) => matches(path, candidate))) {
    const screen = route.segments.filter((segment) => !isGroup(segment)).join("/");
    const best = byScreen.get(screen);
    const better =
      best === undefined ||
      shared(caller, route) > shared(caller, best) ||
      (shared(caller, route) === shared(caller, best) && route.id < best.id);
    if (better) byScreen.set(screen, route);
  }
  return [...byScreen.values()];
}

interface Edge {
  readonly from: Route;
  readonly to: Route;
  readonly call: Call;
}

const calls = routes.flatMap((route) =>
  closureOf(route.file).flatMap((file) => callsIn(file).map((call) => ({ route, call }))),
);
const edges: Edge[] = calls.flatMap(({ route, call }) =>
  (call.paths ?? []).flatMap((path) =>
    targetsOf(route, path).map((to) => ({ from: route, to, call })),
  ),
);

const presentationOf = (name: string): string | undefined =>
  Object.entries(PRESENTATIONS).find(([route]) => route === name)?.[1];

const presentedModally = (navigator: Navigator): boolean => {
  const parent = parentOf(navigator);
  const name = navigator.dir.split("/").at(-1) ?? "";
  return parent !== undefined && MODAL.has(presentationOf(name) ?? "");
};

/**
 * A replace has to stay in the caller's stack, since across stacks it swaps out
 * the whole stack the caller sits in. A push returns by the platform back when
 * it lands in the caller's own stack or a stack around it. Anywhere else the
 * target has to be the first screen of its navigator: a tab root the tab bar
 * returns from, or the root of a modal that dismisses itself.
 */
function backReturns({ from, to, call }: Edge): boolean {
  const caller = from.navigator;
  const target = to.navigator;
  if (call.replaces) return caller.dir === target.dir;
  const around = target.dir === "" || `${caller.dir}/`.startsWith(`${target.dir}/`);
  const parent = parentOf(target);
  return around || (isRoot(to) && (parent?.tabs === true || presentedModally(target)));
}

it("resolves every navigation target from source to a route", () => {
  const unresolved = calls.filter(
    ({ call }) =>
      call.paths === undefined ||
      call.paths.some((path) => !routes.some((route) => matches(path, route))),
  );

  expect(unresolved.map(({ call }) => call.at)).toEqual([]);
  expect(edges.length).toBeGreaterThan(0);
});

it("leaves no route unreachable", () => {
  const reached = new Set(edges.filter(({ from, to }) => from !== to).map(({ to }) => to.id));
  const entered = (route: Route): boolean =>
    route.id === "+not-found" || (isRoot(route) && parentOf(route.navigator)?.tabs === true);

  expect(
    routes.filter((route) => !reached.has(route.id) && !entered(route)).map(({ id }) => id),
  ).toEqual([]);
});

it("lands every navigation where the platform back returns to its origin", () => {
  expect(
    edges
      .filter((edge) => !backReturns(edge))
      .map(({ from, to, call }) => `${from.id} -> ${to.id} (${call.at})`),
  ).toEqual([]);
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
  ...REPLACE,
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
  const navigator = descendants(sourceOf(route.navigator.file))
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
