import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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

const repositoryWithGrowth = (): string => {
  const repository = tempDirectory("cue-diff-footprint-");
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Cue Tests");
  git(repository, "config", "user.email", "cue-tests@example.invalid");
  write(repository, "packages/core/src/removed.ts", "const removed = true;\n");
  write(repository, "packages/core/test/removed.ts", "removed\n");
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  write(repository, "packages/core/src/removed.ts", "const kept = true;\n// reason\n");
  write(repository, "packages/native/app/route.tsx", "export const route = true;\n");
  write(repository, "packages/native/modules/module.ts", "export const module = true;\n");
  write(repository, "packages/native/__tests__/added.ts", "one\ntwo\n");
  git(repository, "add", "-A");
  git(repository, "commit", "--quiet", "-m", "head");
  return repository;
};

const rationale = "Product-Growth: New route and module.\nComment-Load: Required context.";

describe("diff footprint", () => {
  it("shows the three requested growth signals", () => {
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
    expect(output).toContain("| Test lines in test, __tests__, and e2e paths | +2 |");
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
