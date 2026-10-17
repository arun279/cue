import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const BUTTON = "[300,60][390,104]";

const screen = (label: string, button = 'class="android.view.ViewGroup" clickable="true"') =>
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][402,874]">
<node index="0" text="" ${button} bounds="${BUTTON}">
<node index="0" text="Done" class="android.widget.TextView" clickable="false" bounds="${label}" />
</node>
<node index="1" text="Up Next" class="android.widget.TextView" clickable="false" bounds="[16,120][200,160]" />
</node>
</hierarchy>`;

const run = (xml: string, density = "160") => {
  const file = path.join(tempDirectory("cue-label-fit-"), "screen.xml");
  writeFileSync(file, xml);
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-label-fit.mjs"), file, "8", "4", density],
    { encoding: "utf8" },
  );
};

it("accepts a label inset 8 dp across and 4 dp down inside its button", () => {
  const result = run(screen("[308,64][382,100]"));
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Measured 1 labelled buttons; 0 crowd their edge.");
});

it.each([
  ["leading", "[307,64][382,100]"],
  ["trailing", "[308,64][383,100]"],
  ["top", "[308,63][382,100]"],
  ["bottom", "[308,64][382,101]"],
])("fails a label that crowds its button's %s edge", (_edge, label) => {
  const result = run(screen(label));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`"Done" ${label} in ${BUTTON}`);
});

it("measures insets in density-independent pixels", () => {
  expect(run(screen("[308,64][382,100]"), "320").status).toBe(1);
  expect(run(screen("[301,61][389,103]"), "1").status).toBe(0);
  expect(run(screen("[308,64][382,100]"), "").stderr).toContain("density must be a positive dpi");
});

it("reads a button by its class when the node is not clickable", () => {
  const result = run(
    screen("[302,64][382,100]", 'class="android.widget.Button" clickable="false"'),
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`"Done" [302,64][382,100] in ${BUTTON}`);
});

it("fails a screen where no labelled button could be measured", () => {
  const result = run(
    screen("[308,64][382,100]", 'class="android.view.ViewGroup" clickable="false"'),
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("no labelled button to measure");
});
