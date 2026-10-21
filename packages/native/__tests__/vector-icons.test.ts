/** @jest-environment node */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import ts from "typescript";
import { PALETTE } from "../src/ui/tokens";
import { nativeSourceFiles } from "./support/native-sources";

/**
 * Android draws a vector drawable in the color written into it unless the surface
 * tints it, so a hard-coded fill only follows the theme where something tints the
 * icon, which is Android lint's guidance for vector icons. The icons bundled from src
 * carry a plain fill and may only be drawn where they are tinted. The header's
 * navigation icon is drawn without a tint, so it comes from a native drawable whose fill is
 * a color resource with a night variant.
 */

const root = join(__dirname, "..");
const headerIcons: {
  readonly INK: { readonly light: string; readonly dark: string };
  readonly icons: Readonly<Record<string, string>>;
  writeHeaderIcons(res: string): void;
} = require("../plugins/with-android-header-icons.js");

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Use = readonly [name: string, element: JsxTag | undefined];

function attribute(element: JsxTag, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

/** A toolbar item, a Compose icon given a tint, an image styled with a tint, or a menu item image. */
function tinted([name, element]: Use): boolean {
  if (element === undefined) return name === "image";
  const tag = element.tagName.getText();
  if (name === "icon") return tag.startsWith("Stack.Toolbar.");
  if (name !== "source") return false;
  if (tag === "Icon") return attribute(element, "tint") !== undefined;
  return tag === "Image" && /\btintColor\b/.test(attribute(element, "style")?.getText() ?? "");
}

/** Where a value is drawn: a JSX attribute on an element, an object property, or wherever its variable goes. */
function usesOf(node: ts.Node, source: ts.SourceFile): Use[] {
  let value = node;
  while (ts.isConditionalExpression(value.parent) || ts.isParenthesizedExpression(value.parent))
    value = value.parent;
  const parent = value.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent))
    return [[parent.parent.name.getText(), parent.parent.parent.parent]];
  if (ts.isPropertyAssignment(parent)) return [[parent.name.getText(), undefined]];
  if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return [["", undefined]];
  const name = parent.name;
  const references: ts.Identifier[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && child.text === name.text && child !== name)
      references.push(child);
    ts.forEachChild(child, visit);
  };
  visit(source);
  return references.flatMap((reference) => usesOf(reference, source));
}

const bundledVector = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  node.expression.getText() === "require" &&
  node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text.endsWith(".xml"));

function vectorsWithoutTint(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (bundledVector(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const use of usesOf(node, source).filter((candidate) => !tinted(candidate)))
        found.push(
          `${relative(root, file)}:${line} drawn without a tint as ${use[0] || "a value"}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it("draws the vector icons bundled from src only where the surface tints them", () => {
  expect(nativeSourceFiles().flatMap(vectorsWithoutTint)).toEqual([]);
});

it("gives the header navigation icon, which nothing tints, a fill that follows the theme", () => {
  const res = mkdtempSync(join(tmpdir(), "cue-header-icons-"));
  try {
    headerIcons.writeHeaderIcons(res);
    const read = (path: string) => readFileSync(join(res, path), "utf8");

    for (const name of Object.keys(headerIcons.icons))
      expect(read(`drawable/${name}.xml`)).toContain('android:fillColor="@color/cue_header_ink"');
    expect(read("values/cue_header_ink.xml")).toContain(headerIcons.INK.light);
    expect(read("values-night/cue_header_ink.xml")).toContain(headerIcons.INK.dark);
    expect(headerIcons.INK).toEqual(PALETTE.fg);
  } finally {
    rmSync(res, { recursive: true, force: true });
  }
});
