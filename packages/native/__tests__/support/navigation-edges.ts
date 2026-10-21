import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { PRESENTATIONS } from "../../src/presentation";
import { nativeSourceFiles } from "./native-sources";

/**
 * The navigation graph as the source declares it: the route files under app/, the
 * navigators their layouts declare, and every navigation call the modules of each
 * route make, as the method and the paths its href can evaluate to. Which screen
 * a path reaches is left to the real router.
 */

export const appRoot = join(__dirname, "../../app");
export const SHEET_CLOSE = join(__dirname, "../../src/ui/SheetClose.tsx");
export const NAVIGATE = new Set(["push", "navigate", "dismissTo", "replace"]);
const isNavigation = (method: string): boolean => NAVIGATE.has(method);
export const DISMISS = new Set(["back", "dismiss", "dismissAll"]);
export const MODAL = new Set(["modal", "fullScreenModal", "pageSheet", "formSheet"]);
export const isGroup = (segment: string): boolean => segment.startsWith("(");

export interface Navigator {
  readonly dir: string;
  readonly file: string;
  readonly tabs: boolean;
  readonly root: string | undefined;
}

export interface Route {
  readonly id: string;
  readonly segments: readonly string[];
  readonly file: string;
  readonly navigator: Navigator;
}

const parsed = new Map<string, ts.SourceFile>();
export function sourceOf(file: string): ts.SourceFile {
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

export function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

// Metro swaps the harness entry for its stand-in in store builds (metro.config.js), and the
// graph is the store build's: the harness navigates only on a measuring host's command.
const STORE_BUILD = new Map([
  [join(__dirname, "../../src/ui/harness.tsx"), join(__dirname, "../../src/ui/harness.store.ts")],
]);

function resolveImport(from: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) return [];
  const base = resolve(dirname(from), specifier);
  return [".tsx", ".ts", ".android.tsx", ".ios.tsx", "/index.tsx", "/index.ts"]
    .map((suffix) => base + suffix)
    .filter(existsSync)
    .map((file) => STORE_BUILD.get(file) ?? file);
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

export function closureOf(file: string): string[] {
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

export function tagOf(node: ts.Node): string | undefined {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
    ? node.tagName.getText()
    : undefined;
}

export function attributeOf(node: ts.Node, name: string): ts.Expression | undefined {
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

export function screensOf(navigator: Navigator): ts.Node[] {
  return closureOf(navigator.file)
    .flatMap((file) => descendants(sourceOf(file)))
    .filter((node) => tagOf(node) === "Stack.Screen" && attributeOf(node, "name") !== undefined);
}

export function screenName(navigator: Navigator, screen: ts.Node): string | undefined {
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

export const navigators = filesUnder(appRoot)
  .filter((file) => file.endsWith("/_layout.tsx"))
  .flatMap((file) => {
    const dir = relative(appRoot, dirname(file));
    return expand(dir === "" ? [] : dir.split("/")).map((segments) =>
      navigatorAt(segments.join("/"), file),
    );
  });

export const navigatorOf = (path: string): Navigator =>
  navigators
    .filter((navigator) => navigator.dir === "" || `${path}/`.startsWith(`${navigator.dir}/`))
    .reduce((deepest, navigator) =>
      navigator.dir.length > deepest.dir.length ? navigator : deepest,
    );

export const routes: Route[] = filesUnder(appRoot)
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

export const nameIn = (route: Route): string =>
  route.navigator.dir === "" ? route.id : route.id.slice(route.navigator.dir.length + 1);
export const parentOf = (navigator: Navigator): Navigator | undefined =>
  navigator.dir === "" ? undefined : navigatorOf(navigator.dir.split("/").slice(0, -1).join("/"));
export const isRoot = (route: Route): boolean => route.navigator.root === nameIn(route);

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

/** An href a link component only passes through from its own props; its targets are read where it is used. */
function forwardedProp(node: ts.Node, href: ts.Expression): boolean {
  if (!ts.isIdentifier(href)) return false;
  for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
    if (ts.isFunctionLike(scope))
      return scope.parameters.some((parameter) =>
        descendants(parameter.name).some(
          (binding) => ts.isIdentifier(binding) && binding.text === href.text,
        ),
      );
  }
  return false;
}

type RouterMethod = "push" | "navigate" | "dismissTo" | "replace";

/** A navigation: a router method, or an exported function of `module` that hands its href to the router. */
export interface Call {
  readonly at: string;
  readonly method: RouterMethod | string;
  readonly module?: string;
  readonly paths: readonly string[] | undefined;
}

const routerCall = (
  node: ts.Node,
): node is ts.CallExpression & { expression: ts.PropertyAccessExpression } =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.expression.getText() === "router" &&
  node.arguments[0] !== undefined;

/** Exported functions that pass one of their own parameters to the router, by name. */
const navigationFunctions = new Map(
  nativeSourceFiles().flatMap((file) =>
    descendants(sourceOf(file)).flatMap((node) => {
      if (!routerCall(node) || !isNavigation(node.expression.name.text)) return [];
      const href = node.arguments[0];
      const owner = href && forwardedProp(node, href) ? enclosingFunction(node) : undefined;
      return owner?.name ? [[owner.name.text, file] as const] : [];
    }),
  ),
);

function enclosingFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
  for (let scope = node.parent; scope !== undefined; scope = scope.parent)
    if (ts.isFunctionDeclaration(scope)) return scope;
  return undefined;
}

function linkAt(file: string, node: ts.Node): Omit<Call, "at"> | undefined {
  const href = attributeOf(node, "href");
  if (href === undefined || forwardedProp(node, href)) return undefined;
  return { method: tagOf(node) === "Redirect" ? "replace" : "push", paths: pathsIn(file, href) };
}

/** A navigation call at a node: a link, a call of a navigation helper, or a router method. */
function callAt(file: string, node: ts.Node): Omit<Call, "at"> | undefined {
  if (!ts.isCallExpression(node)) return linkAt(file, node);
  const argument = node.arguments[0];
  if (argument === undefined) return undefined;
  if (ts.isIdentifier(node.expression)) {
    const module = navigationFunctions.get(node.expression.text);
    return module
      ? { method: node.expression.text, module, paths: pathsIn(file, argument) }
      : undefined;
  }
  return routerCall(node) &&
    isNavigation(node.expression.name.text) &&
    !forwardedProp(node, argument)
    ? { method: node.expression.name.text, paths: pathsIn(file, argument) }
    : undefined;
}

function callsIn(file: string): Call[] {
  const source = sourceOf(file);
  return descendants(source).flatMap((node) => {
    const call = callAt(file, node);
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    return call ? [{ at: `${relative(appRoot, file)}:${line}`, ...call }] : [];
  });
}

export const presentationOf = (name: string): string | undefined =>
  Object.entries(PRESENTATIONS).find(([route]) => route === name)?.[1];

export const presentedModally = (navigator: Navigator): boolean => {
  const parent = parentOf(navigator);
  const name = navigator.dir.split("/").at(-1) ?? "";
  return parent !== undefined && MODAL.has(presentationOf(name) ?? "");
};

export interface Edge {
  readonly from: Route;
  readonly call: Call;
}

export const edges: Edge[] = routes.flatMap((route) =>
  closureOf(route.file).flatMap((file) => callsIn(file).map((call) => ({ from: route, call }))),
);

/** The route a router segment list names, with an index route named by its directory. */
export const routeAt = (segments: readonly string[]): Route | undefined =>
  routes.find(
    (route) =>
      route.segments.filter((segment) => segment !== "index").join("/") === segments.join("/"),
  );

/**
 * A concrete href for each screen a path can reach, with 7 for every parameter. A
 * segment interpolated from data, as in `/${type}/${id}`, takes each screen name
 * that fits, so the router decides between them as it does in the app.
 */
export function concreteLinks(path: string): string[] {
  const [pathname = "", query] = path.split("?");
  const parts = pathname.split("/").filter(Boolean);
  const groups = parts.filter(isGroup);
  const wanted = parts.filter((part) => !isGroup(part));
  const isParam = (name: string) => /^\[.+\]$/.test(name);
  const links = routes.flatMap((route) => {
    const names = route.segments.filter((segment) => !isGroup(segment) && segment !== "index");
    const fits =
      groups.every((group) => route.segments.includes(group)) &&
      wanted.length === names.length &&
      wanted.every(
        (part, index) => part === "*" || names[index] === part || isParam(names[index] ?? ""),
      );
    if (!fits) return [];
    const concrete = [...groups, ...names.map((name) => (isParam(name) ? "7" : name))];
    return [`/${concrete.join("/")}${query === undefined ? "" : `?${query}`}`];
  });
  return [...new Set(links)];
}
