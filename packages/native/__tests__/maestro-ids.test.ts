/** @jest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { TEST_IDS } from "../src/ui/test-ids";

const flowsDirectory = join(__dirname, "../../../.maestro/flows");
const nativeDirectories = [join(__dirname, "../src"), join(__dirname, "../app")];

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
  const declared: readonly (string | ((...ids: number[]) => string))[] = Object.values(TEST_IDS);
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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
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
  const literals = nativeDirectories
    .flatMap(sourceFiles)
    .filter((file) => readFileSync(file, "utf8").includes('testID="'));

  expect(literals).toEqual([]);
});

it("declares only ids used by a native surface", () => {
  const vocabularyPath = join(__dirname, "../src/ui/test-ids.ts");
  const keys = [
    ...readFileSync(vocabularyPath, "utf8").matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm),
  ].map((match) => match[1]);
  const source = nativeDirectories
    .flatMap(sourceFiles)
    .filter((file) => file !== vocabularyPath)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  expect(keys.filter((key) => !source.includes(`TEST_IDS.${key}`))).toEqual([]);
});
