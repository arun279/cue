import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const prePushCheck =
  readFileSync(repositoryPath("lefthook.yml"), "utf8").match(
    /^pre-push:\n[\s\S]*?^ {4}check:\n[\s\S]*?^ {6}run: (.+)$/m,
  )?.[1] ?? "";

const workersSeenByCheck = (env: NodeJS.ProcessEnv): string =>
  execFileSync("sh", ["-c", `pnpm() { printf '%s' "$JEST_MAX_WORKERS"; }; ${prePushCheck}`], {
    encoding: "utf8",
    env,
  });

const maxWorkers = (env: NodeJS.ProcessEnv): unknown =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ["-p", 'JSON.stringify(require("./jest.config.js").maxWorkers ?? null)'],
      { cwd: repositoryPath("packages/native"), encoding: "utf8", env },
    ),
  );

it("runs the pre-push check with two Jest workers unless the caller picks a number", () => {
  const { JEST_MAX_WORKERS: _, ...inherited } = process.env;

  expect(workersSeenByCheck(inherited)).toBe("2");
  expect(workersSeenByCheck({ ...inherited, JEST_MAX_WORKERS: "4" })).toBe("4");
});

it("caps Jest's workers only when JEST_MAX_WORKERS is set, leaving CI on Jest's default", () => {
  const { JEST_MAX_WORKERS: _, ...inherited } = process.env;

  expect(maxWorkers({ ...inherited, JEST_MAX_WORKERS: "2" })).toBe("2");
  expect(maxWorkers(inherited)).toBeNull();
});
