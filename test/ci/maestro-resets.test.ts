import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const FLOWS = repositoryPath(".maestro/flows");
const SUITES = repositoryPath(".maestro/ci");
const MAESTRO = repositoryPath(".maestro");

// A reinstall, a keychain reset and a sign-in cost a flow 30 to 45 s on a
// macOS runner before its first assertion; a relaunch keeps the session.
const FULL_RESET = new Set([
  // Sign in from a fresh install.
  "launch.yaml",
  "dark-traversal.yaml",
  // Open a shard, so nothing has signed in before them.
  "calendar.yaml",
  "up-next-mark-and-undo.yaml",
]);

const yamlIn = (directory: string): string[] =>
  readdirSync(directory).filter((name) => name.endsWith(".yaml"));

const references = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^\s*-?\s*(?:runFlow|file): ([\w./-]+\.yaml)$/gm)].map(
    ([, reference = ""]) => path.resolve(path.dirname(file), reference),
  );

const resets = (file: string): boolean =>
  /^\s+clear(?:State|Keychain): true$/m.test(readFileSync(file, "utf8")) ||
  references(file).some(resets);

// Without a permissions map, launchApp pulls the APK and runs pm grant per permission, which
// has stalled a relaunch of the running app for six minutes on the Android emulator.
const sweepsPermissions = (launch: string): boolean =>
  !/^\s+(?:clearState: true|permissions: \{\})$/m.test(launch);

const launches = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^( *)- launchApp\b.*\n(?:\1 {4}.*\n)*/gm)].map(
    ([launch]) => launch,
  );

describe("Maestro app resets", () => {
  it("reinstalls and signs in only in the flows that need a fresh install", () => {
    const resetting = yamlIn(FLOWS).filter((name) => resets(path.join(FLOWS, name)));

    expect(new Set(resetting)).toEqual(FULL_RESET);
  });

  it("opens every suite with a flow that signs in from a fresh install", () => {
    const openers = yamlIn(SUITES).flatMap((suite) => {
      const [first] = references(path.join(SUITES, suite));
      return first === undefined ? [] : [[suite, path.basename(first)]];
    });

    expect(openers.filter(([, flow = ""]) => !FULL_RESET.has(flow))).toEqual([]);
  });

  it("runs every flow from a suite", () => {
    const run = new Set(
      yamlIn(SUITES).flatMap((suite) =>
        references(path.join(SUITES, suite)).map((flow) => path.basename(flow)),
      ),
    );

    expect(yamlIn(FLOWS).filter((flow) => !run.has(flow))).toEqual([]);
  });

  it("leaves permissions alone in every launch that keeps the install", () => {
    const sweeping = readdirSync(MAESTRO, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".yaml"))
      .filter((name) => launches(path.join(MAESTRO, name)).some(sweepsPermissions));

    expect(sweeping).toEqual([]);
  });
});
