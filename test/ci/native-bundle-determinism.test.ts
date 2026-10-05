import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

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

const compileInFreshDirectory = () => {
  const directory = tempDirectory("hermes-");
  const bundle = path.join(directory, "index.android.bundle");
  const output = path.join(directory, "index.android.hbc");
  writeFileSync(bundle, "print(1);");
  execFileSync(repositoryPath("scripts/compile-hermes.sh"), [bundle, output]);
  return readFileSync(output);
};

it("compiles a re-embedded bundle to the same bytes whatever directory holds it", () => {
  expect(compileInFreshDirectory()).toEqual(compileInFreshDirectory());
});

const gradlePlugin = repositoryPath(
  "node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react",
);

it("compiles a re-embedded bundle exactly as the Android release build does", () => {
  const extension = readFileSync(path.join(gradlePlugin, "ReactExtension.kt"), "utf8");
  const defaults = /val hermesFlags: ListProperty<String> =[\s\S]*?convention\(listOf\(([^)]*)\)\)/
    .exec(extension)?.[1]
    ?.split(",")
    .map((flag) => flag.trim().replaceAll('"', ""));
  const directory = tempDirectory("hermes-flags-");
  const bundle = path.join(directory, "index.android.bundle");
  writeFileSync(bundle, "function greet(name) { return 'hi ' + name; }\nprint(greet('cue'));\n");
  const compiler = repositoryPath(
    `node_modules/hermes-compiler/hermesc/${process.platform === "darwin" ? "osx-bin" : "linux64-bin"}/hermesc`,
  );
  execFileSync(compiler, [
    "-w",
    "-emit-binary",
    "-max-diagnostic-width=80",
    "-out",
    path.join(directory, "gradle.hbc"),
    bundle,
    ...(defaults ?? []),
  ]);
  execFileSync(repositoryPath("scripts/compile-hermes.sh"), [
    bundle,
    path.join(directory, "embedded.hbc"),
  ]);

  expect(defaults).toEqual(["-O", "-output-source-map"]);
  expect(readFileSync(path.join(directory, "embedded.hbc"))).toEqual(
    readFileSync(path.join(directory, "gradle.hbc")),
  );
});

it("bundles every re-embedded bundle without minifying, as release builds with Hermes do", () => {
  const configuration = readFileSync(path.join(gradlePlugin, "TaskConfiguration.kt"), "utf8");
  const embeds = readdirSync(repositoryPath("scripts"))
    .filter((name) => name.endsWith(".sh"))
    .map((name) => readFileSync(repositoryPath(`scripts/${name}`), "utf8"))
    .flatMap((script) => script.match(/expo export:embed [^\n]*/g) ?? []);

  expect(configuration).toContain("task.minifyEnabled.set(!isHermesEnabledInThisVariant)");
  expect(embeds).toHaveLength(2);
  for (const embed of embeds) expect(embed).toContain("--dev false --minify false");
});
