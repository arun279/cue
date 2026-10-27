/** @jest-environment node */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PALETTE } from "../src/ui/tokens";

const headerIcons: {
  readonly INK: { readonly light: string; readonly dark: string };
  readonly icons: Readonly<Record<string, string>>;
  writeHeaderIcons(res: string): void;
} = require("../plugins/with-android-header-icons.js");

it("gives the header navigation icon, which nothing tints, a fill that follows the theme", () => {
  const res = mkdtempSync(join(tmpdir(), "cue-header-icons-"));
  try {
    headerIcons.writeHeaderIcons(res);
    const read = (path: string) => readFileSync(join(res, path), "utf8");

    for (const name of Object.keys(headerIcons.icons))
      expect(read(`drawable/${name}.xml`)).toContain('android:fillColor="@color/cue_header_ink"');
    expect(read("values/cue_header_ink.xml")).toContain(headerIcons.INK.light);
    expect(read("values-night/cue_header_ink.xml")).toContain(headerIcons.INK.dark);
    expect(headerIcons.INK).toEqual(PALETTE.fg);
  } finally {
    rmSync(res, { recursive: true, force: true });
  }
});
