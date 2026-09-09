import { execFileSync } from "node:child_process";
import path from "node:path";
import { gitEnv } from "./git-env";

export const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  env: gitEnv(),
}).trim();

export const repositoryPath = (...parts: string[]): string => path.join(REPOSITORY_ROOT, ...parts);
