import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const node = (bounds: string, extra: object = {}, children: object[] = []) => ({
  attributes: { bounds, ...extra },
  children,
});

const button = (label: string) => node("[300,60][390,104]", {}, [node(label, { text: "Done" })]);

const run = (root?: object) => {
  const artifacts = tempDirectory("cue-label-fit-");
  if (root !== undefined)
    writeFileSync(path.join(artifacts, "screen.hierarchy.json"), JSON.stringify(root));
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-label-fit.mjs"), artifacts, "8", "4"],
    { encoding: "utf8" },
  );
};

it("accepts a label inset 8 across and 4 down inside its button", () => {
  const result = run(
    node("[0,0][402,874]", {}, [{ ...button("[308,64][382,100]"), clickable: true }]),
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| screen.hierarchy.json | 1 | 1 | 0 |");
});

it.each([
  ["leading", "[307,64][382,100]"],
  ["trailing", "[308,64][383,100]"],
  ["top", "[308,63][382,100]"],
  ["bottom", "[308,64][382,101]"],
])("fails a label that crowds its button's %s edge", (_edge, label) => {
  const result = run(node("[0,0][402,874]", {}, [{ ...button(label), clickable: true }]));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`"Done" ${label} in [300,60][390,104]`);
});

it("reads an Android button by its class", () => {
  const result = run({
    ...button("[300,60][390,104]"),
    attributes: { bounds: "[300,60][390,104]", class: "android.widget.Button" },
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("| screen.hierarchy.json | 1 | 1 | 1 |");
});

it("counts a button that exposes no label frame without measuring it", () => {
  const result = run(
    node("[0,0][402,874]", {}, [{ ...node("[300,60][390,104]"), clickable: true }]),
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| screen.hierarchy.json | 1 | 0 | 0 |");
});

it("fails when there is no hierarchy to read", () => {
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("no view hierarchies under");
});
