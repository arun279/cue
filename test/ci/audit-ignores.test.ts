import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const GHSA = "GHSA-aaaa-bbbb-cccc";

const write = (directory: string, name: string, content: string) => {
  const file = path.join(directory, name);
  writeFileSync(file, content);
  return file;
};

const workspace = (directory: string, entry = `- ${GHSA} # forge: build tooling only`) =>
  write(directory, "pnpm-workspace.yaml", `auditConfig:\n  ignoreGhsas:\n    ${entry}\n`);

const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [repositoryPath("scripts", script), ...args], { encoding: "utf8" });

describe("shipped modules", () => {
  const atlas = (directory: string, modulePath: string) =>
    write(
      directory,
      "atlas.jsonl",
      [
        JSON.stringify({ name: "expo-atlas" }),
        JSON.stringify([
          "ios",
          "/root",
          [{ relativePath: "node_modules/@expo/cli/build/metro-require/require.js" }],
          [{ relativePath: modulePath }],
          { dev: false },
        ]),
      ].join("\n"),
    );

  it("passes when no bundle holds an audit-ignored package", () => {
    const directory = tempDirectory("cue-shipped-");
    const result = run(
      "check-shipped-modules.mjs",
      atlas(directory, "node_modules/forger/index.js"),
      workspace(directory),
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails when a bundle holds an audit-ignored package", () => {
    const directory = tempDirectory("cue-shipped-");
    const result = run(
      "check-shipped-modules.mjs",
      atlas(directory, "node_modules/forge/lib/rsa.js"),
      workspace(directory),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`forge (${GHSA}) ships in ios: node_modules/forge/lib/rsa.js`);
  });

  it("fails when an ignore does not name its package", () => {
    const directory = tempDirectory("cue-shipped-");
    const result = run(
      "check-shipped-modules.mjs",
      atlas(directory, "node_modules/forger/index.js"),
      workspace(directory, `- ${GHSA}`),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${GHSA} names no package`);
  });
});

describe("stale audit ignores", () => {
  const report = (directory: string, advisories: object[]) =>
    write(directory, "audit.json", JSON.stringify({ advisories: { ...advisories } }));

  it("passes while the advisory still applies to the named package", () => {
    const directory = tempDirectory("cue-stale-");
    const result = run(
      "check-stale-audit-ignores.mjs",
      report(directory, [{ github_advisory_id: GHSA, module_name: "forge" }]),
      workspace(directory),
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails once the advisory no longer applies", () => {
    const directory = tempDirectory("cue-stale-");
    const result = run(
      "check-stale-audit-ignores.mjs",
      report(directory, []),
      workspace(directory),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${GHSA} no longer applies`);
  });

  it("fails when the advisory is filed against another package", () => {
    const directory = tempDirectory("cue-stale-");
    const result = run(
      "check-stale-audit-ignores.mjs",
      report(directory, [{ github_advisory_id: GHSA, module_name: "braces" }]),
      workspace(directory),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${GHSA} is filed against braces, not forge`);
  });
});
