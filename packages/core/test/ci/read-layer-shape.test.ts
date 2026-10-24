import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = resolve(dirname(new URL(import.meta.url).pathname), "../../src");

function exportedDeclaration(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? ["default"] : [statement.name.text];
  }
  if (ts.isEnumDeclaration(statement)) return [statement.name.text];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) =>
    ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
  );
}

function exportedNames(statement: ts.Statement): string[] {
  if (ts.isExportDeclaration(statement)) {
    if (
      statement.isTypeOnly ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      return [];
    }
    return statement.exportClause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => element.name.text);
  }
  const exported =
    ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  return exported ? exportedDeclaration(statement) : [];
}

function exportedValues(source: string, file: string): string[] {
  return ts
    .createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    .statements.flatMap(exportedNames);
}

async function sourceFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => resolve(directory, file));
}

describe("the core read layer", () => {
  it("keeps one hook value export in every use-named hook file", async () => {
    const files = (await sourceFiles(resolve(src, "hooks"))).filter((file) =>
      basename(file).startsWith("use"),
    );
    for (const file of files) {
      const values = exportedValues(await readFile(file, "utf8"), file);
      expect(values, basename(file)).toHaveLength(1);
      expect(values[0], basename(file)).toMatch(/^use[A-Z0-9]/);
    }
  });

  it("keeps use-named exports out of query declarations", async () => {
    for (const file of await sourceFiles(resolve(src, "queries"))) {
      expect(exportedValues(await readFile(file, "utf8"), file), basename(file)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^use[A-Z0-9]/)]),
      );
    }
  });
});
