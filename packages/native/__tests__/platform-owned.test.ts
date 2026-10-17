/** @jest-environment node */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import ts from "typescript";
import { nativeSourceFiles } from "./support/native-sources";

const root = join(__dirname, "..");

/**
 * Each rule finds app code that draws something the platform already draws, and
 * so loses the platform's own semantics, sizing and dismissal. Search is Cue's
 * only text entry, so rule E counts every TextInput. An exception names the
 * native candidate, why it does not fit, and the package version that judgement
 * was made against, so updating that package reopens it.
 */
const RULES = {
  A: "custom element in a header slot",
  B: "selection state drawn by hand",
  C: "custom modal or bottom sheet",
  D: "back or dismiss outside the navigator",
  E: "text field outside the header search bar",
  F: "native header hidden",
} as const;
type Rule = keyof typeof RULES;

interface Exception {
  readonly file: string;
  readonly rule: Rule;
  readonly site: string;
  readonly candidate: string;
  readonly reason: string;
  readonly source: string;
  readonly checked: { readonly package: string; readonly version: string };
}

const EXCEPTIONS: readonly Exception[] = [
  {
    file: "src/ui/BarItems.tsx",
    rule: "A",
    site: "Stack.Toolbar.View",
    candidate: "Stack.Toolbar.Button with an image icon",
    reason:
      "The avatar is the account's photo or its monogram; a bar button icon is a fixed image source or symbol and cannot draw either.",
    source: "https://docs.expo.dev/router/advanced/stack-toolbar/#icons",
    checked: { package: "expo-router", version: "57.0.25" },
  },
  {
    file: "src/ui/SegmentedControl.tsx",
    rule: "B",
    site: "Pressable",
    candidate:
      "@expo/ui Picker with pickerStyle('segmented') on iOS, SingleChoiceSegmentedButtonRow on Android",
    reason:
      "The Compose segmented row exposed no accessibility node to TalkBack, and a SwiftUI segmented picker drops the identifiers set on its segments, which Maestro could not find by label either, so neither control can be reached the way the flows and screen readers reach this one.",
    source: "https://stackoverflow.com/questions/60894793/segmented-picker-removes-accessibility",
    checked: { package: "@expo/ui", version: "57.0.22" },
  },
  {
    file: "src/screens/library/ChipRail.tsx",
    rule: "B",
    site: "Pressable",
    candidate: "@expo/ui FilterChip on Android",
    reason:
      "Five filters with counts in a scrolling rail have no iOS control, and a Compose chip on Android alone would split one screen into two designs.",
    source: "https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/chip/",
    checked: { package: "@expo/ui", version: "57.0.22" },
  },
  {
    file: "src/screens/history/HistoryChoice.tsx",
    rule: "B",
    site: "Pressable",
    candidate: "@expo/ui DatePicker",
    reason:
      "The month jump picks a year and a month in one tap from a grid; the platform date pickers choose a date or a time, with no month and year mode.",
    source: "https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/datepicker/",
    checked: { package: "@expo/ui", version: "57.0.22" },
  },
  {
    file: "src/ui/CheckControl.tsx",
    rule: "B",
    site: "Pressable",
    candidate: "React Native Switch",
    reason:
      "The check marks an episode or movie watched, with a pending state while the mark syncs; a switch reads as a setting that changes how the app behaves, not as a record of something done.",
    source: "https://developer.apple.com/design/human-interface-guidelines/toggles",
    checked: { package: "react-native", version: "0.86.3" },
  },
  {
    file: "src/screens/search/SearchField.tsx",
    rule: "E",
    site: "TextInput",
    candidate: "@expo/ui DockedSearchBar on Android",
    reason:
      "Search is the search destination, which Material gives a persistent search bar; the Android header search bar collapses into an icon, and DockedSearchBar takes no text, so a recent search could not fill it.",
    source: "https://m3.material.io/components/search/guidelines",
    checked: { package: "@expo/ui", version: "57.0.22" },
  },
  {
    file: "app/_layout.tsx",
    rule: "F",
    site: "headerShown",
    candidate: "a header on the root stack",
    reason:
      "The root stack only switches between the tab group and the account group, and each of those runs its own native stack and header, so a root header would put a second bar above theirs.",
    source: "https://docs.expo.dev/router/advanced/nesting-navigators/",
    checked: { package: "expo-router", version: "57.0.25" },
  },
  {
    file: "src/ui/navigation-theme.tsx",
    rule: "F",
    site: "headerShown",
    candidate: "the native header inside the form sheet",
    reason:
      "The episode sheet and the month jump are form sheets dismissed by their grabber, a downward swipe and system back, and title themselves in their content; a bar would repeat the title in the first detent.",
    source: "https://developer.apple.com/design/human-interface-guidelines/sheets",
    checked: { package: "react-native-screens", version: "4.26.2" },
  },
];

const HEADER_SLOTS = new Set([
  "header",
  "headerLeft",
  "headerRight",
  "headerTitle",
  "unstable_headerLeftItems",
  "unstable_headerRightItems",
]);
const SELECTION_ROLES = new Set(["tab", "radio", "checkbox", "switch"]);
const SELECTION_STATES = new Set(["selected", "checked"]);
const NAVIGATION_RECEIVERS = new Set(["router", "navigation"]);
const BACK_CALLS = new Set(["back", "goBack", "dismiss", "dismissAll", "pop", "popToTop"]);
const SHEETS = /^@expo\/ui[^#]*#(ModalBottomSheet|BottomSheet)$/;

interface Violation {
  readonly rule: Rule;
  readonly file: string;
  readonly site: string;
  readonly at: string;
}

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function importsOf(source: ts.SourceFile): Map<string, string> {
  const origins = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      origins.set(element.name.text, `${statement.moduleSpecifier.text}#${name}`);
    }
  }
  return origins;
}

function attribute(node: JsxTag, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function literal(value: ts.JsxAttribute | undefined): string | undefined {
  const initializer = value?.initializer;
  if (initializer === undefined) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  return expression !== undefined && ts.isStringLiteral(expression) ? expression.text : undefined;
}

function drawsSelection(node: JsxTag): boolean {
  const role = literal(attribute(node, "accessibilityRole")) ?? literal(attribute(node, "role"));
  const state = attribute(node, "accessibilityState")?.initializer;
  const stateObject =
    state !== undefined && ts.isJsxExpression(state) && state.expression !== undefined
      ? state.expression
      : undefined;
  return (
    (role !== undefined && SELECTION_ROLES.has(role)) ||
    attribute(node, "aria-selected") !== undefined ||
    attribute(node, "aria-checked") !== undefined ||
    (stateObject !== undefined &&
      ts.isObjectLiteralExpression(stateObject) &&
      stateObject.properties.some(
        (property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          SELECTION_STATES.has(property.name.getText()),
      ))
  );
}

function rendersElement(value: ts.Expression): boolean {
  return (
    ts.isArrowFunction(value) ||
    ts.isFunctionExpression(value) ||
    ts.isIdentifier(value) ||
    ts.isJsxElement(value) ||
    ts.isJsxSelfClosingElement(value) ||
    ts.isJsxFragment(value)
  );
}

function enclosingTag(node: ts.Node): string | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return parent.parent.parent.tagName.getText();
  }
  return undefined;
}

type ElementCheck = (node: JsxTag, tag: string, origin: string) => boolean;

const ELEMENT_CHECKS: readonly (readonly [Rule, ElementCheck])[] = [
  [
    "A",
    (node, tag) =>
      tag === "Stack.Toolbar.View" ||
      (tag.startsWith("Stack.") && attribute(node, "asChild") !== undefined),
  ],
  ["B", (node, _tag, origin) => drawsSelection(node) && origin !== "react-native#Switch"],
  ["C", (_node, _tag, origin) => origin === "react-native#Modal" || SHEETS.test(origin)],
  ["E", (_node, _tag, origin) => origin === "react-native#TextInput"],
  ["F", (node, tag) => tag === "Stack.Header" && attribute(node, "hidden") !== undefined],
];

function propertyRules(node: ts.PropertyAssignment): Rule[] {
  const key = node.name.getText();
  if (HEADER_SLOTS.has(key) && rendersElement(node.initializer)) return ["A"];
  return key === "headerShown" && node.initializer.kind === ts.SyntaxKind.FalseKeyword ? ["F"] : [];
}

function navigatesBack(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    BACK_CALLS.has(node.expression.name.text) &&
    NAVIGATION_RECEIVERS.has(node.expression.expression.getText()) &&
    !enclosingTag(node)?.startsWith("Stack.Toolbar.")
  );
}

function rulesFor(node: ts.Node, origins: ReadonlyMap<string, string>): Rule[] {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText();
    const origin = origins.get(tag) ?? "";
    return ELEMENT_CHECKS.filter(([, check]) => check(node, tag, origin)).map(([rule]) => rule);
  }
  if (ts.isPropertyAssignment(node)) return propertyRules(node);
  return ts.isCallExpression(node) && navigatesBack(node) ? ["D"] : [];
}

function siteOf(node: ts.Node): string {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    return node.tagName.getText();
  if (ts.isPropertyAssignment(node)) return node.name.getText();
  return ts.isCallExpression(node) ? node.expression.getText() : node.getText();
}

function violationsIn(path: string): Violation[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const origins = importsOf(source);
  const file = relative(root, path);
  const found: Violation[] = [];
  const visit = (node: ts.Node): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    for (const rule of rulesFor(node, origins))
      found.push({ rule, file, site: siteOf(node), at: `${file}:${line}` });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const violations = nativeSourceFiles().flatMap(violationsIn);
const excepts = (exception: Exception, violation: Violation) =>
  exception.file === violation.file &&
  exception.rule === violation.rule &&
  exception.site === violation.site;

it("leaves the UI the platform owns to the platform, outside the registered exceptions", () => {
  expect(
    violations
      .filter((violation) => !EXCEPTIONS.some((exception) => excepts(exception, violation)))
      .map(({ rule, site, at }) => `${rule} (${RULES[rule]}) ${site} at ${at}`),
  ).toEqual([]);
});

it("drops an exception once its file no longer needs it", () => {
  expect(
    EXCEPTIONS.filter(
      (exception) => !violations.some((violation) => excepts(exception, violation)),
    ).map(({ rule, file, site }) => `${rule} ${file} ${site}`),
  ).toEqual([]);
});

it("rechecks an exception when the package it was judged against changes version", () => {
  const resolve = createRequire(join(root, "package.json")).resolve;
  const installed = (name: string): string =>
    JSON.parse(readFileSync(resolve(`${name}/package.json`), "utf8")).version;

  expect(
    EXCEPTIONS.filter(({ checked }) => installed(checked.package) !== checked.version).map(
      ({ rule, file, checked }) =>
        `${rule} ${file}: judged against ${checked.package} ${checked.version}, installed ${installed(checked.package)}`,
    ),
  ).toEqual([]);
});
