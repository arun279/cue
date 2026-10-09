/** @jest-environment node */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { parseAllDocuments } from "yaml";
import { HARNESS_IDS } from "../src/ui/harness-ids";
import { TEST_IDS } from "../src/ui/test-ids";
import { nativeSourceFiles } from "./support/native-sources";

const flowsDirectory = join(__dirname, "../../../.maestro/flows");
const appDirectory = join(__dirname, "../app");

/**
 * The wildcard a flow uses where a list gives one element per entity. Maestro
 * matches `id` as a regular expression, so `queue-row-[0-9]+` selects the row
 * whatever show it holds; the same row named by its entity is `queue-row-8805`.
 * Both have to resolve to the factory that draws them, and no other wildcard
 * spelling does, which is what keeps this gate a whitelist.
 */
const DIGITS = "[0-9]+";
const PROBE_IDS = [1, 2, 3];

function declaredPatterns(): RegExp[] {
  const declared: readonly (string | ((...ids: number[]) => string))[] = [
    ...Object.values(TEST_IDS),
    ...Object.values(HARNESS_IDS),
  ];
  return declared.map(
    (value) =>
      new RegExp(
        `^${typeof value === "string" ? value : value(...PROBE_IDS).replace(/[0-9]+/g, DIGITS)}$`,
      ),
  );
}

function yamlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? yamlFiles(path) : entry.name.endsWith(".yaml") ? [path] : [];
  });
}

function collectIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectIds);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "id" && typeof child === "string" ? [child] : collectIds(child),
  );
}

it("uses only accessibility ids declared by the native app", () => {
  const patterns = declaredPatterns();
  const referenced = yamlFiles(flowsDirectory).flatMap((file) =>
    parseAllDocuments(readFileSync(file, "utf8")).flatMap((document) =>
      collectIds(document.toJS()),
    ),
  );

  expect(referenced).not.toEqual([]);
  expect(
    referenced.filter(
      (id) => !patterns.some((pattern) => pattern.test(id.replaceAll(DIGITS, "0"))),
    ),
  ).toEqual([]);
});

it("spells test ids only in the shared vocabulary", () => {
  const literals = nativeSourceFiles().filter((file) =>
    readFileSync(file, "utf8").includes('testID="'),
  );

  expect(literals).toEqual([]);
});

it("declares only ids used by a native surface", () => {
  const vocabularyPath = join(__dirname, "../src/ui/test-ids.ts");
  const keys = [
    ...readFileSync(vocabularyPath, "utf8").matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm),
  ].map((match) => match[1]);
  const source = nativeSourceFiles()
    .filter((file) => file !== vocabularyPath)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  expect(keys.filter((key) => !source.includes(`TEST_IDS.${key}`))).toEqual([]);
});

const INPUT_PROP = /^(on(Press|LongPress|Change|ChangeText|ValueChange|SubmitEditing)|href)$/;
const FIXED_IDS = new Set(
  Object.entries(TEST_IDS).flatMap(([key, value]) => (typeof value === "string" ? [key] : [])),
);

function resolveImport(from: string, specifier: string): string[] {
  const base = resolve(dirname(from), specifier);
  return [".tsx", ".ts", ".android.tsx", ".ios.tsx", "/index.tsx", "/index.ts"]
    .map((suffix) => base + suffix)
    .filter(existsSync);
}

interface Binding {
  readonly files: readonly string[];
  readonly name: string;
}

interface Site {
  readonly tag: string;
  readonly ids: readonly string[];
  readonly forwarded: boolean;
  readonly input: boolean;
}

interface Declaration {
  readonly sites: readonly Site[];
  readonly references: readonly string[];
}

interface SourceModule {
  readonly declarations: ReadonlyMap<string, Declaration>;
  readonly links: ReadonlyMap<string, Binding>;
}

function siteOf(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): Site {
  const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
  const testID =
    attributes.find((attribute) => attribute.name.getText() === "testID")?.initializer?.getText() ??
    "";
  return {
    tag: node.tagName.getText(),
    ids: testID.match(/(?<=TEST_IDS\.)\w+/g) ?? [],
    forwarded: testID !== "" && !testID.includes("TEST_IDS"),
    input: attributes.some((attribute) => INPUT_PROP.test(attribute.name.getText())),
  };
}

function declarationOf(root: ts.Node): Declaration {
  const sites: Site[] = [];
  const references = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) sites.push(siteOf(node));
    if (ts.isIdentifier(node)) references.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return { sites, references: [...references] };
}

type Named<T> = readonly [string, T];

function linksOf(file: string, statement: ts.Statement): Named<Binding>[] {
  const filesOf = (specifier: ts.Expression | undefined): string[] =>
    specifier === undefined
      ? [file]
      : ts.isStringLiteral(specifier) && specifier.text.startsWith(".")
        ? resolveImport(file, specifier.text)
        : [];
  if (ts.isImportDeclaration(statement)) {
    const files = filesOf(statement.moduleSpecifier);
    const link = (local: string, name: string): Named<Binding> => [local, { files, name }];
    const clause = statement.importClause;
    const named =
      clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : [];
    return [
      ...(clause?.name ? [link(clause.name.text, "default")] : []),
      ...named.map((element) =>
        link(element.name.text, (element.propertyName ?? element.name).text),
      ),
    ];
  }
  if (
    ts.isExportDeclaration(statement) &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
  ) {
    const files = filesOf(statement.moduleSpecifier);
    return statement.exportClause.elements.map((element) => [
      element.name.getText(),
      { files, name: (element.propertyName ?? element.name).getText() },
    ]);
  }
  return [];
}

function declaredBy(statement: ts.Statement): Named<ts.Node>[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((variable) => [
      variable.name.getText(),
      variable,
    ]);
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    const named = (name: string): Named<ts.Node> => [name, statement];
    const isDefault = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );
    return [named(statement.name.text), ...(isDefault ? [named("default")] : [])];
  }
  return ts.isExportAssignment(statement) ? [["default", statement.expression]] : [];
}

function readModule(file: string): SourceModule {
  const { statements } = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return {
    declarations: new Map(
      statements.flatMap(declaredBy).map(([name, node]) => [name, declarationOf(node)]),
    ),
    links: new Map(statements.flatMap((statement) => linksOf(file, statement))),
  };
}

/**
 * Screens in one stack share the hierarchy while one is pushed over another,
 * and the account stack covers whichever tab presented it. A route that only
 * re-exports another is that screen pushed on a second stack, and a tab root
 * never shares the hierarchy with another tab's root.
 */
interface Screen {
  readonly route: string;
  readonly tabs: readonly string[] | null;
  readonly ids: ReadonlySet<string>;
}

function screens(): Screen[] {
  const modules = new Map<string, SourceModule>();
  const moduleAt = (file: string): SourceModule => {
    const known = modules.get(file) ?? readModule(file);
    modules.set(file, known);
    return known;
  };
  const declarationsOf = (
    file: string,
    name: string,
    seen = new Set<string>(),
  ): [string, Declaration][] => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const module = moduleAt(file);
    const declaration = module.declarations.get(name);
    if (declaration !== undefined) return [[file, declaration]];
    const link = module.links.get(name);
    return link === undefined
      ? []
      : link.files.flatMap((target) => declarationsOf(target, link.name, seen));
  };
  const forwarding = new Map<string, boolean>();
  const isInput = (file: string, site: Site): boolean =>
    site.input ||
    declarationsOf(file, site.tag).some(([target, declaration]) => {
      const key = `${target}#${site.tag}`;
      if (!forwarding.has(key)) {
        forwarding.set(key, false);
        forwarding.set(
          key,
          declaration.sites.some((inner) => inner.forwarded && isInput(target, inner)),
        );
      }
      return forwarding.get(key) === true;
    });
  const reachableIds = (entry: string): Set<string> => {
    const visited = new Set<Declaration>();
    const ids = new Set<string>();
    const pending = declarationsOf(entry, "default");
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const [file, declaration] = next;
      if (visited.has(declaration)) continue;
      visited.add(declaration);
      for (const site of declaration.sites.filter((candidate) => isInput(file, candidate))) {
        for (const id of site.ids.filter((candidate) => FIXED_IDS.has(candidate))) ids.add(id);
      }
      pending.push(
        ...declaration.references.flatMap((reference) => declarationsOf(file, reference)),
      );
    }
    return ids;
  };
  const canonical = (file: string): string => {
    const [target] = moduleAt(file).links.get("default")?.files ?? [];
    return target?.startsWith(appDirectory) ? canonical(target) : file;
  };
  const routes = new Set(
    nativeSourceFiles()
      .filter((file) => file.startsWith(appDirectory) && !file.endsWith("_layout.tsx"))
      .map(canonical),
  );
  return [...routes].map((route) => {
    const [group, tab] = relative(appDirectory, route).split("/");
    return {
      route: relative(appDirectory, route),
      tabs: group === "(tabs)" && tab?.startsWith("(") ? tab.slice(1, -1).split(",") : null,
      ids: reachableIds(route),
    };
  });
}

function shareHierarchy(a: Screen, b: Screen): boolean {
  return a.tabs === null || b.tabs === null || a.tabs.some((tab) => b.tabs?.includes(tab));
}

// History draws the bar items with `avatar={false}`, a prop value the source graph does not follow.
const HIDDEN = new Set(["avatarLink in (account)/history.tsx"]);

it("gives every control an id no other screen in its hierarchy carries", () => {
  const all = screens();
  const shared = all.flatMap((a, index) =>
    all
      .slice(index + 1)
      .filter((b) => shareHierarchy(a, b))
      .flatMap((b) =>
        [...a.ids]
          .filter((id) => b.ids.has(id))
          .filter((id) => !HIDDEN.has(`${id} in ${a.route}`) && !HIDDEN.has(`${id} in ${b.route}`))
          .map((id) => `${id}: ${a.route} and ${b.route}`),
      ),
  );

  expect(all.find((screen) => screen.route === "(account)/settings.tsx")?.ids).toContain(
    "settingsShows",
  );
  expect(shared).toEqual([]);
});
