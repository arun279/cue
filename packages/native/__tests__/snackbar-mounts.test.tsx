import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { showSnack } from "@cue/core/stores/snackbar-store";
import { act, render, screen } from "@testing-library/react-native";
import ts from "typescript";
import { SnackbarHost } from "../src/ui/SnackbarHost";
import { nativeSourceFiles } from "./support/native-sources";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const mounts = nativeSourceFiles().flatMap((file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  const found: { file: string; node: ts.JsxOpeningElement | ts.JsxSelfClosingElement }[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === "SnackbarHost") {
      names.add(node.name.text);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      names.has(node.tagName.getText(source))
    ) {
      found.push({ file: relative(__dirname, file), node });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
});

it("finds the production snackbar mounts", () => expect(mounts.length).toBeGreaterThan(0));

it.each(mounts)("uses the overlay host directly inside the presenting view in $file", async ({
  node,
}) => {
  expect(ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText()).toBe("View");
  expect(node.attributes.properties).toHaveLength(1);
  const placement = node.attributes.properties[0];
  expect(placement?.name?.getText()).toBe("placement");
  const value = placement && ts.isJsxAttribute(placement) && placement.initializer;
  const name = value && ts.isStringLiteral(value) ? value.text : undefined;
  expect(["root", "presentation", "sheet"]).toContain(name);
  if (name !== "root" && name !== "presentation" && name !== "sheet") return;

  await render(<SnackbarHost placement={name} />);
  await act(() => showSnack({ message: "Removed play" }));

  expect(screen.getByTestId("snackbar")).toHaveStyle({ position: "absolute" });
});
