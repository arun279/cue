import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/diff-footprint.sh");

const write = (repository: string, file: string, contents: string): void => {
  const target = path.join(repository, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const git = (repository: string, ...args: string[]): void => {
  execFileSync("git", args, { cwd: repository, stdio: "ignore", env: gitEnv() });
};

const commits = (
  base: Readonly<Record<string, string>>,
  head: Readonly<Record<string, string | null>>,
): string => {
  const repository = tempDirectory("cue-diff-footprint-");
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Cue Tests");
  git(repository, "config", "user.email", "cue-tests@example.invalid");
  for (const [file, contents] of Object.entries(base)) write(repository, file, contents);
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  for (const [file, contents] of Object.entries(head)) {
    if (contents === null) rmSync(path.join(repository, file));
    else write(repository, file, contents);
  }
  git(repository, "add", "-A");
  git(repository, "commit", "--quiet", "-m", "head");
  return repository;
};

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

const rationale = "Product-Growth: New route and module.\nComment-Load: Required context.";

describe("diff footprint", () => {
  it("shows product, test, tooling and comment growth", () => {
    const repository = repositoryWithGrowth();
    const output = execFileSync(SCRIPT, ["HEAD~1"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...gitEnv(), PR_BODY: rationale },
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

  it.each([
    ["Product-Growth: ", "Product code grew"],
    ["Product-Growth: New route.\nComment-Load: ", "Product comments grew"],
  ])("requires a non-empty growth rationale", (body, error) => {
    const result = spawnSync(SCRIPT, ["HEAD~1"], {
      cwd: repositoryWithGrowth(),
      encoding: "utf8",
      env: { ...gitEnv(), PR_BODY: body },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(error);
  });

  it("asks for a rationale only when product code or comments grow", () => {
    const repository = commits(
      { "packages/core/src/kept.ts": "export const kept = true;\n" },
      {
        "test/ci/added.test.ts": "// reason\nadded\n",
        "scripts/added.sh": "# reason\necho added\n",
      },
    );

    const result = spawnSync(SCRIPT, ["HEAD~1"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...gitEnv(), PR_BODY: "" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "| Product code lines in core/src, native/src, native/app, and native/modules | +0 |",
    );
    expect(result.stdout).toContain(
      "| Product comment lines identified by a comment prefix | +0 |",
    );
  });

  it("shows the four delivered artifact measurements", () => {
    const repository = repositoryWithGrowth();
    const sizes = [
      { name: "expo iOS bundle", size: 4_000_000 },
      { name: "expo Android bundle", size: 4_200_000 },
      { name: "Firebase tester APK file", size: 34_000_000 },
      { name: "Play download estimate", size: 17_000_000 },
    ];
    write(repository, "base.json", JSON.stringify({ sizes }));
    write(
      repository,
      "head.json",
      JSON.stringify({
        sizes: sizes.map((entry, index) => ({
          ...entry,
          size: entry.size + (index === 0 ? 1_000 : 0),
        })),
      }),
    );

    const output = execFileSync(SCRIPT, ["HEAD~1", "base.json", "head.json"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...gitEnv(), PR_BODY: rationale },
    });

    expect(output).toContain(
      "| Expo iOS JavaScript bundle, raw file | 4.00 MB | 4.00 MB | +1.0 kB |",
    );
    expect(output).toContain(
      "| Firebase tester APK, arm64-v8a and all densities | 34.00 MB | 34.00 MB | 0 B |",
    );
    expect(output).not.toContain("simulator");
    expect(output).not.toContain("complexity");
    expect(output).not.toContain("density");
  });
});
