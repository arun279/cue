import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { gitHistory } from "../support/git-history";
import { repositoryPath } from "../support/repository-path";

const SCRIPT = repositoryPath("scripts/diff-footprint.sh");
const write = (repository: string, file: string, contents: string): void => {
  const target = path.join(repository, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const commits = (
  base: Readonly<Record<string, string>>,
  head: Readonly<Record<string, string | null>>,
): string => gitHistory([base, head]).repository;

const repositoryWithGrowth = (): string =>
  commits(
    {
      "packages/core/src/removed.ts": "const removed = true;\n",
      "packages/core/test/removed.ts": "removed\n",
      "scripts/removed.sh": "echo removed\n",
    },
    {
      "packages/core/src/removed.ts": "const kept = true;\n// reason\n",
      "packages/native/app/route.tsx": "export const route = true;\n",
      "packages/native/modules/module.ts": "export const module = true;\n",
      "packages/native/__tests__/added.ts": "one\ntwo\n",
      "test/ci/added.test.ts": "one\n\ntwo\nthree\n",
      ".maestro/flows/added.yaml": "- launchApp\n",
      ".github/workflows/ci.yml": "on: push\n# reason\n",
      "scripts/added.sh": "echo added\n",
      "scripts/removed.sh": null,
      "docs/added.md": "uncounted\n",
    },
  );

describe("diff footprint", () => {
  it("shows product, test, tooling and comment growth", () => {
    const repository = repositoryWithGrowth();
    const output = execFileSync(SCRIPT, ["HEAD~1"], {
      cwd: repository,
      encoding: "utf8",
      env: gitEnv(),
    });

    expect(output.split("\n")[0]).toBe("<!-- diff-footprint -->");
    expect(output).toContain(
      "| Product code lines in core/src, native/src, native/app, and native/modules | +2 |",
    );
    expect(output).toContain(
      "| Test lines in test, `packages/*/{test,__tests__,e2e}`, and .maestro | +6 |",
    );
    expect(output).toContain("| CI and tooling lines in .github and scripts | +2 |");
    expect(output).toContain("| Product comment lines identified by a comment prefix | +1 |");
    expect(output).not.toContain("other");
    expect(output).not.toContain("blank");
  });

  it("reports the head's JavaScript bundle sizes from an Expo export", () => {
    const repository = repositoryWithGrowth();
    write(repository, "dist/_expo/static/js/ios/entry-1.hbc", "x".repeat(4000));
    write(repository, "dist/_expo/static/js/android/entry-2.hbc", "x".repeat(5000));

    const output = execFileSync(SCRIPT, ["HEAD~1", path.join(repository, "dist")], {
      cwd: repository,
      encoding: "utf8",
      env: gitEnv(),
    });

    expect(output).toContain("| Expo ios bundle | 4 kB |\n| Expo android bundle | 5 kB |");
  });
});
