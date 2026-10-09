#!/usr/bin/env node
// Usage: write-buster.mjs --check | --bump | --reseed
//
// The persisted-cache buster (query-client.ts) and the shape witness it is
// keyed to. `--check` recomputes the witness and fails when the committed one
// disagrees; `--bump` writes both literals to the recomputed witness; `--reseed`
// writes the witness alone, for the commit that changes what the witness is
// taken over while leaving every shape where it was.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The trees that DEFINE every persisted shape. `runtime` is the `CueRuntime`
 * port, which types every cached value, and the query-cache policy, which names
 * the key heads that are persisted at all; those types resolve entirely into
 * `data` and `domain`, so no shape a restored cache is replayed against can
 * change without changing a byte here. Moving a file between these trees, or
 * into a package, is not a shape change, so these roots may be repathed without
 * bumping anything.
 *
 * A whole directory rather than a list of files, so a module added to one of
 * them is inside the witness by default: an over-bust costs a cold read, an
 * under-bust corrupts silently and forever. That is also why the two kinds of
 * module that carry no persisted type live outside these roots rather than as
 * exemptions here. The composition root is `app/`, and the device ports are
 * `ports/`; both are edited far more often than a shape ever changes, and every
 * one of those edits would otherwise cost every shipping user their cache.
 */
const SHAPE_TREES = [
  "packages/core/src/domain",
  "packages/core/src/data",
  "packages/core/src/runtime",
];

const GENERATED = "packages/core/src/runtime/persist-buster.ts";

/**
 * One `import`, `export ... from` or side-effect `import` statement, from the
 * keyword at the start of a line to the terminating semicolon. `[^;]*?` is what
 * lets the clause span lines without the match running past the end of the
 * statement, so a wrapped named-import list is one match and
 * `export const A = { from: "b" };` is none.
 */
const IMPORT_STATEMENT =
  /^(?:import|export)(?![\w$])[^;]*?\bfrom\s*(["'])((?:[^"'\\\n]|\\.)*)\1\s*;|^import\s*(["'])((?:[^"'\\\n]|\\.)*)\3\s*;/gm;

/** Every specifier that resolves outside the shape trees, collapsed to one token. */
const OUTSIDE = "\0outside";

const sha = (parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(`${part}\n`);
  return hash.digest("hex");
};

/**
 * A file split into its import statements and everything else.
 *
 * The body keeps its source order, because order is part of a shape: moving a
 * field from one interface to a second interface in the same file leaves the
 * file's set of lines untouched and changes what a persisted value is replayed
 * against. The statements are hashed as a sorted multiset instead, which is
 * what makes the digest blind to organize-imports reordering the block. Nothing
 * in an import line states a shape on its own, but which module a name is bound
 * to does, so the statement text is kept and only its specifier is rewritten.
 */
function split(source) {
  const statements = [];
  const body = source.replace(IMPORT_STATEMENT, (statement, ...groups) => {
    statements.push({ statement, specifier: groups[1] ?? groups[3] });
    return "";
  });
  return {
    statements,
    body: body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

const digestOf = (statements, body, specifierOf) =>
  sha([
    ...statements.map((each) => each.statement.replace(each.specifier, specifierOf(each))).sort(),
    "--",
    ...body,
  ]);

/**
 * A file's digest with every specifier collapsed, which makes it a content
 * address: the same file has the same value under any path, and under any
 * spelling of the imports that reach it. This is what a module is identified by
 * below, so that moving a file between the trees, or respelling
 * `@domain/up-next` as `@cue/core/domain/up-next` across all of them, moves
 * nothing.
 */
const contentAddress = (source) => {
  const { statements, body } = split(source);
  return digestOf(statements, body, () => OUTSIDE);
};

function filesUnder(tree) {
  const root = join(ROOT, tree);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => join(tree, entry))
    .filter((path) => statSync(join(ROOT, path)).isFile() && path !== GENERATED);
}

/** `./x`, `../x` and `@cue/core/x` as a repository path; anything else is null. */
function resolve(fromPath, specifier) {
  if (specifier.startsWith("@cue/core/")) {
    return `packages/core/src/${specifier.slice("@cue/core/".length)}.ts`;
  }
  return specifier.startsWith(".") ? `${join(dirname(fromPath), specifier)}.ts` : null;
}

/**
 * A digest per file, sorted, then hashed. No path component enters the hash, so
 * a file that moves between the trees produces the same witness; a file added,
 * deleted, edited, or repointed at a different in-tree module does not.
 */
function shapeWitness() {
  const paths = SHAPE_TREES.flatMap(filesUnder);
  const sources = new Map(paths.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
  const addresses = new Map([...sources].map(([path, source]) => [path, contentAddress(source)]));
  const digests = paths
    .map((path) => {
      const { statements, body } = split(sources.get(path));
      return digestOf(
        statements,
        body,
        ({ specifier }) => addresses.get(resolve(path, specifier)) ?? OUTSIDE,
      );
    })
    .sort();
  return sha(digests).slice(0, 12);
}

const generatedPath = join(ROOT, GENERATED);
const readField = (name) => {
  const source = readFileSync(generatedPath, "utf8");
  const match = source.match(new RegExp(`\\b${name}: "([0-9a-f]{12})"`));
  if (!match) throw new Error(`${GENERATED} carries no ${name} field`);
  return match[1];
};

const computed = shapeWitness();
const mode = process.argv[2];

if (mode === "--check") {
  const shape = readField("shape");
  if (shape !== computed) {
    process.stderr.write(
      `buster:check failed: committed shape ${shape}, computed ${computed}.\n` +
        "A persisted shape changed. Run `pnpm buster:bump` and commit the result.\n",
    );
    process.exit(1);
  }
  process.stdout.write(`buster:check ok (shape ${shape}, buster ${readField("buster")})\n`);
} else if (mode === "--bump") {
  writeFileSync(generatedPath, render(computed, computed));
  process.stdout.write(`buster:bump wrote shape ${computed}, buster ${computed}\n`);
} else if (mode === "--reseed") {
  const buster = readField("buster");
  writeFileSync(generatedPath, render(buster, computed));
  process.stdout.write(`buster:reseed wrote shape ${computed}, buster ${buster} unchanged\n`);
} else {
  process.stderr.write("Usage: write-buster.mjs --check | --bump | --reseed\n");
  process.exit(2);
}

function render(buster, shape) {
  return `// Generated by scripts/write-buster.mjs. Run \`pnpm buster:bump\` to update.
export const PERSISTED_CACHE = {
  buster: "${buster}",
  shape: "${shape}",
} as const;
`;
}
