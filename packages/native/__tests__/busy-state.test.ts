/** @jest-environment node */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { nativeSourceFiles } from "./support/native-sources";

const root = join(__dirname, "..");

/**
 * A control that starts a sync and draws nothing while it runs is the silent
 * button this rule exists to prevent: every caller of `useSyncNow` reads its
 * `syncing`, and every RefreshControl spins on `usePullToRefresh`'s
 * `refreshing`, which is that same state.
 */
const calls = (node: ts.Node, name: string): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;

const readsSyncing = (node: ts.Node): boolean =>
  (ts.isPropertyAccessExpression(node) && node.name.text === "syncing") ||
  (ts.isBindingElement(node) && node.name.getText() === "syncing");

function pullName(node: ts.Node): string | undefined {
  return calls(node, "usePullToRefresh") &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
    ? node.parent.name.text
    : undefined;
}

function refreshingOf(node: ts.Node): ts.Expression | null | undefined {
  if (!(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))) return undefined;
  if (node.tagName.getText() !== "RefreshControl") return undefined;
  const initializer = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === "refreshing",
  )?.initializer;
  return initializer !== undefined && ts.isJsxExpression(initializer)
    ? (initializer.expression ?? null)
    : null;
}

function violationsIn(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const file = relative(root, path);
  const pulls = new Set<string>();
  const spinners: ts.Node[] = [];
  let syncs = false;
  let shown = false;

  const visit = (node: ts.Node): void => {
    syncs ||= calls(node, "useSyncNow");
    shown ||= readsSyncing(node);
    const pull = pullName(node);
    if (pull !== undefined) pulls.add(pull);
    const refreshing = refreshingOf(node);
    const fromPull =
      refreshing !== undefined &&
      refreshing !== null &&
      ts.isPropertyAccessExpression(refreshing) &&
      refreshing.name.text === "refreshing" &&
      pulls.has(refreshing.expression.getText());
    if (refreshing !== undefined && !fromPull) spinners.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [
    ...spinners.map(
      (node) =>
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} RefreshControl spins on something other than usePullToRefresh`,
    ),
    ...(syncs && !shown ? [`${file} starts a sync and never shows it running`] : []),
  ];
}

it("shows every sync it starts for as long as it runs", () => {
  expect(nativeSourceFiles().flatMap(violationsIn)).toEqual([]);
});
