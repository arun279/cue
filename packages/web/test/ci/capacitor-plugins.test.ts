import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import capacitorConfig from "../../../../capacitor.config";

const REPOSITORY_ROOT = path.join(import.meta.dirname, "../../../..");

const capacitorNames = (record: Record<string, string> | undefined): readonly string[] =>
  Object.keys(record ?? {})
    .filter((name) => name.startsWith("@capacitor/"))
    .sort();

const manifest = (file: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"));

/**
 * Capacitor discovers plugins from the manifest beside `capacitor.config.ts`,
 * which is the root's, while the code that imports them lives in the web
 * package and declares them there. `includePlugins` is what bridges the two,
 * and its own comment concedes the failure it buys: "adding a plugin to the web
 * package without adding it here leaves it out of the binaries", silently, in a
 * release build. `verify-apk.sh` catches only a plugin that adds a permission,
 * and iOS has no equivalent at all.
 *
 * So the three lists are pinned to each other. The shells and the web app must
 * want exactly the same plugins, and the root must declare them itself rather
 * than reach them through the hoisted linker, so `cap sync` keeps working the
 * day the workspace stops hoisting.
 */
describe("the plugin set the shells build", () => {
  const web = capacitorNames(manifest("packages/web/package.json").dependencies);
  const root = capacitorNames(manifest("package.json").dependencies);

  // `?? []` rather than an assertion: deleting the key is one of the ways the
  // shells lose a plugin, so it has to fail this comparison, not throw before it.
  it("is exactly what the web app imports", () => {
    expect([...(capacitorConfig.includePlugins ?? [])].sort()).toEqual(
      web.filter((name) => name !== "@capacitor/core"),
    );
  });

  it("is declared by the root, which is the manifest Capacitor reads", () => {
    expect(root).toEqual(web);
  });
});
