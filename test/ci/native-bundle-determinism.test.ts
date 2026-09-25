import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const native = repositoryPath("packages/native");
const require = createRequire(import.meta.url);

it("numbers each platform's modules as if it were bundled alone", () => {
  const { serializer } = require(path.join(native, "metro.config.js"));
  const alone = serializer.createModuleIdFactory();
  const shared = serializer.createModuleIdFactory();
  shared("ios-only.js", { platform: "ios" });
  shared("shared.js", { platform: "ios" });
  const ids = (createId: typeof alone) =>
    ["shared.js", "android-only.js"].map((file) => createId(file, { platform: "android" }));
  expect(ids(shared)).toEqual(ids(alone));
});

it("compiles the same bundle to the same number of bytes every time", async () => {
  const { buildHermesBundleAsync } = require("@expo/metro-config/build/serializer/exportHermes");
  const sizes = new Set();
  for (let run = 0; run < 20; run += 1) {
    const { hbc } = await buildHermesBundleAsync({ projectRoot: native, code: "print(1);" });
    sizes.add(hbc.length);
  }
  expect(sizes.size).toBe(1);
});
