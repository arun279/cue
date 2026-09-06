/** @jest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { TEST_IDS } from "../src/ui/test-ids";

const flowsDirectory = join(__dirname, "../../../.maestro/flows");

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
  const declared: ReadonlySet<string> = new Set(
    Object.values(TEST_IDS).filter((value) => typeof value === "string"),
  );
  const referenced = yamlFiles(flowsDirectory).flatMap((file) =>
    parseAllDocuments(readFileSync(file, "utf8")).flatMap((document) =>
      collectIds(document.toJS()),
    ),
  );

  expect(referenced).not.toEqual([]);
  expect(referenced.filter((id) => !declared.has(id))).toEqual([]);
});
