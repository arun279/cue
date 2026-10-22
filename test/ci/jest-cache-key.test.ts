import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jestCacheKey } from "../../scripts/jest-cache-key.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const FILES: Readonly<Record<string, string>> = {
  "package.json": "{}\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "README.md": "readme\n",
  "app/babel.config.js": 'module.exports = { plugins: ["./plugin.js"] };\n',
  "app/plugin.js": 'require("./helper.js");\nmodule.exports = () => ({ visitor: {} });\n',
  "app/helper.js": "module.exports = 1;\n",
  "app/jest.config.js": "module.exports = { testMatch: [] };\n",
};

const TRACKED = Object.keys(FILES);

function repository(): string {
  const root = tempDirectory("cue-jest-cache-key-");
  for (const [file, contents] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  symlinkSync(repositoryPath("node_modules"), path.join(root, "node_modules"));
  return root;
}

describe("jest-cache-key.mjs", () => {
  it.each([
    "app/plugin.js",
    "app/helper.js",
    "app/babel.config.js",
    "app/jest.config.js",
    "pnpm-lock.yaml",
  ])("changes when %s changes", (file) => {
    const root = repository();
    const before = jestCacheKey(root, TRACKED);

    writeFileSync(path.join(root, file), `${FILES[file]}// edited\n`);

    expect(jestCacheKey(root, TRACKED)).not.toBe(before);
  });

  it("stays put when a file the transforms do not depend on changes", () => {
    const root = repository();
    const before = jestCacheKey(root, TRACKED);

    writeFileSync(path.join(root, "README.md"), "edited\n");

    expect(jestCacheKey(root, TRACKED)).toBe(before);
  });
});

it("keys the check job's transform cache exactly, with no looser fallback", () => {
  const check = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).find(
    ({ name }) => name === "check",
  );
  const restore = check?.body.slice(0, check.body.indexOf("      - run: pnpm check\n")) ?? "";

  expect(restore).toContain("node scripts/jest-cache-key.mjs");
  expect(restore).toMatch(/key: \$\{\{ steps\.jest-cache\.outputs\.key \}\}\n/);
  expect(restore).not.toContain("restore-keys");
});
