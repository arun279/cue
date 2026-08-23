import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  env: gitEnv(),
}).trim();
const SCRIPT = path.join(REPOSITORY_ROOT, "scripts/diff-footprint.sh");
const repositories: string[] = [];

const write = (repository: string, file: string, contents: string | Uint8Array): void => {
  const target = path.join(repository, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const git = (repository: string, ...args: string[]): void => {
  execFileSync("git", args, { cwd: repository, stdio: "ignore", env: gitEnv() });
};

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("diff footprint", () => {
  it("reports area totals and product line types from the same uncompressed diff", () => {
    const repository = mkdtempSync(path.join(tmpdir(), "cue-diff-footprint-"));
    repositories.push(repository);
    git(repository, "init", "--quiet");
    git(repository, "config", "user.name", "Cue Tests");
    git(repository, "config", "user.email", "cue-tests@example.invalid");

    write(repository, "packages/web/src/removed.ts", "const removed = true;\n// removed\n\n");
    write(repository, "packages/web/test/moved.ts", "one\ntwo\n");
    write(repository, "packages/web/e2e/removed.ts", "removed\n");
    write(repository, "docs/removed.md", "removed\n");
    write(repository, "assets/image.bin", new Uint8Array([0, 1, 2]));
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "base");

    git(repository, "mv", "packages/web/test/moved.ts", "packages/web/src/moved.ts");
    rmSync(path.join(repository, "packages/web/src/removed.ts"));
    rmSync(path.join(repository, "packages/web/e2e/removed.ts"));
    rmSync(path.join(repository, "docs/removed.md"));
    write(repository, "packages/web/src/added.ts", "const added = true;\n /* added */\n \n");
    write(repository, "packages/web/test/added.ts", "added\n");
    write(repository, "packages/web/e2e/added.ts", "one\ntwo\n");
    write(repository, "docs/added.md", "one\ntwo\nthree\n");
    write(repository, "assets/image.bin", new Uint8Array([0, 3, 4]));
    git(repository, "add", "-A");
    git(repository, "commit", "--quiet", "-m", "change");

    const output = execFileSync(SCRIPT, ["HEAD~1"], {
      cwd: repository,
      encoding: "utf8",
      env: gitEnv(),
    });

    expect(output.split("\n")[0]).toBe("<!-- diff-footprint -->");
    expect(output).toContain("| product (packages/*/src/) | 5 | 3 | +2 |");
    expect(output).toContain("| tests (packages/*/test/) | 1 | 2 | -1 |");
    expect(output).toContain("| e2e (packages/*/e2e/) | 2 | 1 | +1 |");
    expect(output).toContain("| other | 3 | 1 | +2 |");
    expect(output).toContain("| total | 11 | 7 | +4 |");
    expect(output).toContain(
      "Product lines: code +3 / -1 (net +2), comments +1 / -1, blank +1 / -1",
    );
  });
});
