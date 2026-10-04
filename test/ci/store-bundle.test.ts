import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const check = (contents: string) => {
  const dist = tempDirectory("cue-store-bundle-");
  mkdirSync(path.join(dist, "ios"));
  writeFileSync(path.join(dist, "ios/entry.hbc"), contents);
  return spawnSync(process.execPath, [repositoryPath("scripts/check-store-bundle.mjs"), dist], {
    encoding: "utf8",
  });
};

it("passes a bundle without UI harness markers", () => {
  expect(check("\u0000screen-up-next\u0000queue-row-").status).toBe(0);
});

it("fails a bundle that carries a harness marker id or label", () => {
  const result = check("\u0000app-idle-timing\u0000Returning-user app idle: \u0000");

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("entry.hbc: app-idle");
  expect(result.stderr).toContain("entry.hbc: Returning-user app idle");
});
