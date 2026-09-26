/** The request journal used by the core harness. */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createJournal(file) {
  if (file === undefined || file === "") return { record: () => {}, file: null };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "", "utf8");
  return {
    file,
    record(method, path, search, body) {
      appendFileSync(file, `${JSON.stringify({ method, path, search, body })}\n`, "utf8");
    },
  };
}

export const readJournal = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
