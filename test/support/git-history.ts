import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gitEnv } from "./git-env";
import { tempDirectory } from "./temp-directory";

/** The files a commit writes, with `null` for a file it deletes. */
type Commit = Readonly<Record<string, string | null>>;

const change = ([file, contents]: [string, string | null]): string =>
  contents === null
    ? `D ${file}`
    : `M 100644 inline ${file}\ndata ${Buffer.byteLength(contents)}\n${contents}`;

/**
 * A repository whose `main` holds `commits` in order, with their SHAs.
 *
 * One `git fast-import` writes the whole history, where an add and a commit per
 * step cost two processes each and made a fixture slow enough to time out on a
 * loaded machine. Only commits are written: the index and working tree stay
 * empty, which suits scripts that compare commits.
 */
export function gitHistory(commits: readonly Commit[]): {
  readonly repository: string;
  readonly shas: readonly string[];
} {
  const repository = tempDirectory("cue-git-history-");
  const marks = path.join(repository, ".git", "marks");
  const git = (args: readonly string[], input?: string): void => {
    execFileSync("git", args, { cwd: repository, env: gitEnv(), input, stdio: "pipe" });
  };
  git(["init", "--quiet", "--initial-branch=main"]);
  const stream = commits.flatMap((files, index) => [
    "commit refs/heads/main",
    `mark :${index + 1}`,
    `committer Cue Tests <cue-tests@example.invalid> ${index} +0000`,
    "data 0",
    ...Object.entries(files).map(change),
    "",
  ]);
  git(["fast-import", "--quiet", `--export-marks=${marks}`], stream.join("\n"));
  const shas = readFileSync(marks, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" "))
    .sort(([a], [b]) => Number(a?.slice(1)) - Number(b?.slice(1)))
    .map(([, sha]) => sha ?? "");
  return { repository, shas };
}
