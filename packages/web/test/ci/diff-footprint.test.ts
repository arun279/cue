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

const newRepository = (): string => {
  const repository = mkdtempSync(path.join(tmpdir(), "cue-diff-footprint-"));
  repositories.push(repository);
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Cue Tests");
  git(repository, "config", "user.email", "cue-tests@example.invalid");
  return repository;
};

const sizes = (initial: number, all: number, ios: number, android: number) => [
  { name: "web initial load", size: initial, sizeLimit: 170_000 },
  { name: "web all JavaScript and CSS", size: all, sizeLimit: 285_000 },
  { name: "expo iOS bundle", size: ios, sizeLimit: 4_450_000 },
  { name: "expo Android bundle", size: android, sizeLimit: 4_830_000 },
];

const HEAD_METRICS = {
  sizes: sizes(101_500, 200_000, 4_001_000, 4_200_000),
  complexity: { functions: 496, max: 71, over15: 21, sum: 2484, mean: 5.01 },
  comments: {
    packages: {
      core: { code: 3000, comments: 1200, blank: 100, density: 28.57 },
      web: { code: 3000, comments: 500, blank: 200, density: 14.29 },
      native: { code: 3000, comments: 800, blank: 200, density: 21.05 },
    },
    total: { code: 9000, comments: 1050, blank: 500, density: 10.5 },
  },
};

const BASE_METRICS = {
  sizes: sizes(100_000, 200_000, 4_000_000, 4_200_000),
  complexity: { functions: 480, max: 60, over15: 18, sum: 2400, mean: 5 },
  comments: {
    packages: {
      core: { code: 3000, comments: 1100, blank: 100, density: 26.83 },
      web: { code: 3000, comments: 450, blank: 200, density: 13.04 },
      native: { code: 3000, comments: 750, blank: 200, density: 20 },
    },
    total: { code: 9000, comments: 1000, blank: 500, density: 10 },
  },
};

const runWithMetrics = (base: unknown): string => {
  const repository = newRepository();
  write(repository, "packages/web/src/only.ts", "const only = true;\n");
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "head");
  write(repository, "base-metrics.json", JSON.stringify(base));
  write(repository, "head-metrics.json", JSON.stringify(HEAD_METRICS));

  return execFileSync(SCRIPT, ["HEAD~1", "base-metrics.json", "head-metrics.json"], {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  });
};

describe("diff footprint", () => {
  it("reports area totals and product line types from the same uncompressed diff", () => {
    const repository = newRepository();

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

  it("reports every metric as a base-to-head delta", () => {
    const output = runWithMetrics(BASE_METRICS);

    expect(output).toContain(
      "| web initial load (brotli) | 100.0 kB | 101.5 kB | +1.5 kB | 170 kB |",
    );
    expect(output).toContain(
      "| web all js and css (brotli) | 200.0 kB | 200.0 kB | 0 B | 285 kB |",
    );
    expect(output).toContain("| expo ios bundle (raw) | 4.00 MB | 4.00 MB | +1.0 kB | 4450 kB |");
    expect(output).toContain("| expo android bundle (raw) | 4.20 MB | 4.20 MB | 0 B | 4830 kB |");
    expect(output).toContain("| functions over cognitive complexity 15 | 18 | 21 | +3 |");
    expect(output).toContain("| worst cognitive complexity | 60 | 71 | +11 |");
    expect(output).toContain(
      "| mean cognitive complexity (functions scoring 2 or more) | 5.00 | 5.01 | +0.01 |",
    );
    expect(output).toContain("| product comment density | 10.00 percent | 10.50 percent | +0.50 |");
    expect(output).toContain("| core comment density | 26.83 percent | 28.57 percent | +1.74 |");
    expect(output).toContain("| web comment density | 13.04 percent | 14.29 percent | +1.25 |");
    expect(output).toContain("| native comment density | 20.00 percent | 21.05 percent | +1.05 |");
    expect(output).not.toContain("n/a");
  });

  it("reads a base it could not measure as unavailable instead of as zero", () => {
    const output = runWithMetrics({ sizes: null, complexity: null, comments: null });

    expect(output).toContain("| web initial load (brotli) | n/a | 101.5 kB | n/a | 170 kB |");
    expect(output).toContain("| expo ios bundle (raw) | n/a | 4.00 MB | n/a | 4450 kB |");
    expect(output).toContain("| functions over cognitive complexity 15 | n/a | 21 | n/a |");
    expect(output).toContain("| product comment density | n/a | 10.50 percent | n/a |");
    expect(output).toContain(
      "The merge base does not contain the measured packages, so its columns read n/a.",
    );
  });
});
