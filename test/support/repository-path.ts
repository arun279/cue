import { execFileSync } from "node:child_process";
import path from "node:path";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

export const repositoryPath = (...parts: string[]): string => path.join(REPOSITORY_ROOT, ...parts);
