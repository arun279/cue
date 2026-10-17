import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The core is reached through one wildcard export key, `"./*": "./src/*.ts"`.
 * Node's subpath patterns are a substring substitution with no extension
 * search, so a `.tsx` under this tree is unreachable by every consumer, and a
 * `.css` is unreachable by a bundler that has no CSS pipeline. The compiler
 * cannot see either: with `lib: ["ES2023"]` and no `"dom"`, a DOM global is a
 * type error but DOM JSX in a `.tsx` produces none at all.
 *
 * `--others --exclude-standard` is what makes this fail in the pre-commit hook:
 * `git ls-files` alone reads the index, so a newly added file that is not yet
 * committed would pass here and fail only in CI, after the commit exists.
 */
const sourceFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src"],
  { cwd: new URL("../..", import.meta.url), encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

describe("core portability", () => {
  it.each([".tsx", ".css"])("carries no %s file", (extension) => {
    expect(
      sourceFiles.filter((file) => file.endsWith(extension)),
      `@cue/core is reached through one "./*": "./src/*.ts" export key, which resolves neither .tsx nor .css. Keep the file in the app that renders it.`,
    ).toEqual([]);
  });
});
