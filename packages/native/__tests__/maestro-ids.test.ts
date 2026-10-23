/** @jest-environment node */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { parseAllDocuments } from "yaml";
import { HARNESS_IDS } from "../src/ui/harness-ids";
import { TEST_IDS } from "../src/ui/test-ids";
import { nativeSourceFiles } from "./support/native-sources";

const maestroDirectory = join(__dirname, "../../../.maestro");
const flowsDirectory = join(maestroDirectory, "flows");
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
  const referenced = yamlFiles(maestroDirectory).flatMap((file) =>
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
const HIDDEN = new Set(["avatarLink in (tabs)/(up-next,library,calendar,search)/history.tsx"]);

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

  expect(
    all.find((screen) => screen.route === "(tabs)/(up-next,library,calendar,search)/settings.tsx")
      ?.ids,
  ).toContain("settingsShows");
  expect(shared).toEqual([]);
});

function flakeMasks(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flakeMasks);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (
      key === "retryTapIfNoChange" ||
      (key === "optional" && child === true) ||
      (key === "id" && child === "app-idle")
    )
      return [key];
    return flakeMasks(child);
  });
}

it("requires one input and persistent acknowledgments in every device flow", () => {
  expect(
    yamlFiles(maestroDirectory).flatMap((file) =>
      parseAllDocuments(readFileSync(file, "utf8")).flatMap((document) =>
        flakeMasks(document.toJS()).map((mask) => `${relative(maestroDirectory, file)}: ${mask}`),
      ),
    ),
  ).toEqual([]);
});

it.each([
  { tapOn: { id: "settings-sign-out", retryTapIfNoChange: true } },
  { extendedWaitUntil: { notVisible: { id: "episode-sheet" }, optional: true } },
  { runFlow: { commands: [{ assertVisible: { id: "app-idle" } }] } },
])("rejects a nested flake mask: %j", (flow) => {
  expect(flakeMasks(flow)).toHaveLength(1);
});

/** Header and row menu triggers share this label, and a row's trigger stays in the hierarchy
 * under a pushed detail screen, so a flow can find the label while the header never drew. */
const SHARED_TRIGGER_LABEL = /^More actions for /;

function unidentifiedTriggers(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(unidentifiedTriggers);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "string" &&
    SHARED_TRIGGER_LABEL.test(child) &&
    (key !== "text" || !("id" in value))
      ? [child]
      : unidentifiedTriggers(child),
  );
}

it("selects every menu trigger by its id as well as its shared label", () => {
  expect(
    yamlFiles(maestroDirectory).flatMap((file) =>
      parseAllDocuments(readFileSync(file, "utf8")).flatMap((document) =>
        unidentifiedTriggers(document.toJS()).map(
          (label) => `${relative(maestroDirectory, file)}: ${label}`,
        ),
      ),
    ),
  ).toEqual([]);
});

it.each([
  { tapOn: "More actions for The Lantern Keeper" },
  { extendedWaitUntil: { visible: "More actions for Midnight Cartography" } },
  { runFlow: { commands: [{ assertVisible: { text: "More actions for Harbor Lights" } }] } },
])("rejects a menu trigger selected by its label alone: %j", (flow) => {
  expect(unidentifiedTriggers(flow)).toHaveLength(1);
});

it("accepts a menu trigger selected by its id and label", () => {
  expect(
    unidentifiedTriggers({
      tapOn: { id: TEST_IDS.movieDetailMore, text: "More actions for The Lantern Keeper" },
    }),
  ).toEqual([]);
});

type Command = Record<string, unknown>;

const SETTINGS_CONTROL = /^(settings-|switch-|theme-)/;
const SETTLE_SCROLL = { runFlow: "lib/settle-scroll.yaml" };

function commandLists(value: unknown): Command[][] {
  if (Array.isArray(value)) return [value as Command[], ...value.flatMap(commandLists)];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(commandLists);
}

const targetOf = (command: Command | undefined, verb: string): unknown => {
  const body = command?.[verb] as { id?: unknown; element?: { id?: unknown } } | undefined;
  return verb === "scrollUntilVisible" ? body?.element?.id : body?.id;
};

/** A tap that lands while the list is still moving, or at the screen's bottom edge where
 * iOS defers touches to its home gesture, stops the scroll instead of reaching the control. */
function unsettledScrollTaps(commands: Command[]): string[] {
  return commands.flatMap((command, index) => {
    const id = targetOf(command, "tapOn");
    if (typeof id !== "string" || !SETTINGS_CONTROL.test(id)) return [];
    const settled = JSON.stringify(commands[index - 1]) === JSON.stringify(SETTLE_SCROLL);
    const scroll = commands[settled ? index - 2 : index - 1];
    if (targetOf(scroll, "scrollUntilVisible") !== id) return [];
    const centred =
      (scroll?.["scrollUntilVisible"] as { centerElement?: unknown }).centerElement === true;
    return settled && centred ? [] : [id];
  });
}

it("centres every Settings control it scrolls to and waits for the scroll to settle before tapping it", () => {
  const taps = yamlFiles(flowsDirectory).flatMap((file) =>
    parseAllDocuments(readFileSync(file, "utf8"))
      .flatMap((document) => commandLists(document.toJS()))
      .flatMap(unsettledScrollTaps)
      .map((id) => `${relative(flowsDirectory, file)}: ${id}`),
  );

  expect(taps).toEqual([]);
});

const MEDIA_SWITCHES: Readonly<Record<string, string>> = {
  [TEST_IDS.settingsMovies]: TEST_IDS.settingsShows,
  [TEST_IDS.settingsShows]: TEST_IDS.settingsMovies,
};

/** A tapped switch's own value flips natively at the touch, while the other media switch is
 * enabled or disabled by the app from the preference, so only the other one proves the change
 * landed before the flow moves on. The tapped switch then has to report the matching on or off,
 * which is what a screen reader announces. */
function unconfirmedMediaTaps(commands: Command[]): string[] {
  return commands.flatMap((command, index) => {
    const id = targetOf(command, "tapOn");
    const other = typeof id === "string" ? MEDIA_SWITCHES[id] : undefined;
    if (other === undefined) return [];
    const { enabled } = (commands[index + 1]?.["assertVisible"] ?? {}) as { enabled?: unknown };
    const expected = [
      { assertVisible: { id: other, enabled } },
      { assertVisible: { id, checked: enabled } },
    ];
    const confirmed =
      typeof enabled === "boolean" &&
      isDeepStrictEqual(commands.slice(index + 1, index + 3), expected);
    return confirmed ? [] : [String(id)];
  });
}

it("waits for the app to apply every media switch tap, then checks the switch reports it", () => {
  const taps = yamlFiles(flowsDirectory).flatMap((file) =>
    parseAllDocuments(readFileSync(file, "utf8"))
      .flatMap((document) => commandLists(document.toJS()))
      .flatMap(unconfirmedMediaTaps)
      .map((id) => `${relative(flowsDirectory, file)}: ${id}`),
  );

  expect(taps).toEqual([]);
});

it("waits for onboarding readiness, then for the device code after one Connect tap", () => {
  const source = readFileSync(join(flowsDirectory, "lib/sign-in.yaml"), "utf8");
  const commands = parseAllDocuments(source)[1]?.toJS();
  expect(commands[0]).toEqual({
    extendedWaitUntil: { visible: { id: HARNESS_IDS.onboardingReady }, timeout: 90000 },
  });
  expect(commands.slice(2, 4)).toEqual([
    { tapOn: { id: TEST_IDS.buttonConnect } },
    { extendedWaitUntil: { visible: { id: TEST_IDS.deviceCodeValue }, timeout: 30000 } },
  ]);
  expect(commands.filter((command: object) => "tapOn" in command)).toHaveLength(1);
});

it("fails within seconds when the input before an operation wait never started it", () => {
  const source = readFileSync(join(flowsDirectory, "lib/settle.yaml"), "utf8");
  const commands = parseAllDocuments(source)[1]?.toJS();
  expect(commands[0]).toEqual({
    extendedWaitUntil: {
      visible: {
        id: HARNESS_IDS.operationStarted,
        text: `\${"(.*; )?" + output.operation + ";.*"}`,
      },
      timeout: 10000,
      label: `\${"Tap or swipe not delivered: " + output.operation + " never started"}`,
    },
  });
  expect(commands[1].extendedWaitUntil.visible.id).toBe(HARNESS_IDS.operationCompleted);
});

it("waits for presentation, closes the sheet from its close control, and checks it is gone", () => {
  const source = readFileSync(join(flowsDirectory, "lib/dismiss-episode-sheet.yaml"), "utf8");
  expect(parseAllDocuments(source)[1]?.toJS()).toEqual([
    { extendedWaitUntil: { visible: { id: HARNESS_IDS.sheetPresented }, timeout: 10000 } },
    { tapOn: "Close" },
    { extendedWaitUntil: { notVisible: { id: TEST_IDS.episodeSheet }, timeout: 10000 } },
  ]);
});

function expectMonthJumpReadiness(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((command, index) => {
      if (command?.tapOn?.id === TEST_IDS.historyJump) {
        expect(value[index + 1]).toEqual({
          extendedWaitUntil: { visible: { id: HARNESS_IDS.sheetPresented }, timeout: 10000 },
        });
      }
      expectMonthJumpReadiness(command);
    });
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach(expectMonthJumpReadiness);
  }
}

it.each(
  yamlFiles(flowsDirectory),
)("waits for presentation after every month-jump opening in %s", (file) => {
  for (const document of parseAllDocuments(readFileSync(file, "utf8"))) {
    expectMonthJumpReadiness(document.toJS());
  }
});

function swipes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(swipes);
  if (value === null || typeof value !== "object") return [];
  const own = "swipe" in value ? [value] : [];
  return [...own, ...Object.values(value).flatMap(swipes)];
}

it("never dismisses a sheet with a synthesized swipe, which is UIKit's gesture rather than Cue's", () => {
  const onSheets = yamlFiles(flowsDirectory).flatMap((file) =>
    parseAllDocuments(readFileSync(file, "utf8")).flatMap((document) =>
      swipes(document.toJS()).filter((command) =>
        JSON.stringify(command).includes(HARNESS_IDS.sheetPresented),
      ),
    ),
  );

  expect(onSheets).toEqual([]);
});

it("types the Library filter in one input and observes durable Watchlist membership", () => {
  const library = readFileSync(join(flowsDirectory, "library.yaml"), "utf8");
  const movie = readFileSync(join(flowsDirectory, "movie-detail.yaml"), "utf8");
  expect([...library.matchAll(/^- inputText: (.*)$/gm)].map((match) => match[1])).toEqual([
    '"coastal"',
  ]);
  expect(movie).toContain('- assertVisible: "In Watchlist"');
});

function hasUnpairedOperation(source: string): boolean {
  let phase: "none" | "prepared" | "input" = "none";
  for (const command of source.split(/\n(?=- )/)) {
    if (command.includes("file: lib/prepare-operation.yaml")) {
      if (phase !== "none") return true;
      phase = "prepared";
    } else if (command.startsWith("- runFlow: lib/settle.yaml")) {
      if (phase !== "input") return true;
      phase = "none";
    } else if (
      phase !== "none" &&
      /^(?:- runFlow:\n\s+when:[\s\S]*\n\s+)?- (tapOn|swipe):/.test(command)
    ) {
      phase = "input";
    }
  }
  return phase !== "none";
}

it("pairs every operation wait with a fresh capture and an input in the same flow", () => {
  expect(
    yamlFiles(flowsDirectory)
      .filter((file) => hasUnpairedOperation(readFileSync(file, "utf8")))
      .map((file) => relative(flowsDirectory, file)),
  ).toEqual([]);
});
