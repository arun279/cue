import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const FLOWS = repositoryPath(".maestro/flows");
const SUITES = repositoryPath(".maestro/ci");
const MAESTRO = repositoryPath(".maestro");
const CONNECT = path.join(FLOWS, "lib/connect.yaml");

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

// Without a permissions map, launchApp grants every permission Maestro knows. On the Android
// emulator that pulls the APK and runs pm grant per permission, which has stalled a relaunch for
// six minutes; on iOS the XCTest driver has died inside that sweep.
const sweepsPermissions = (launch: string): boolean =>
  !/^\s+(?:clearState: true|permissions:)/m.test(launch) || /\ball:/.test(launch);

const launches = (source: string): string[] =>
  [...source.matchAll(/^( *)- launchApp\b.*\n(?:\1 {4}.*\n)*/gm)].map(([launch]) => launch);

const IOS_ONLY = /^( *)- runFlow:\n\1 {4}when:\n\1 {6}platform: iOS\n(?:\1 {4}.*\n)*/gm;

const signsIn = (file: string): boolean =>
  references(file).some((flow) => flow === CONNECT || signsIn(flow));

// Up Next shows a caption until the first mark made on that screen, and the
// dismissal persists on the install until a sign-in clears it, which only a
// suite's first flow does. Each capture of Up Next pins whether it shows.
const CAPTION_SHOWN = {
  "account.yaml": "per platform",
  "dark-traversal.yaml": true,
  "launch.yaml": true,
  "tabs.yaml": true,
  "up-next-mark-and-undo.yaml": true,
};
const DISMISSES_CAPTION = /from:\n\s+id: "(?:queue|lapsed)-row-/;
const ANDROID_ONLY = /^( *)- runFlow:\n\1 {4}when:\n\1 {6}platform: Android\n(?:\1 {4}.*\n)*/gm;
const dismissesEverywhere = (source: string): boolean =>
  DISMISSES_CAPTION.test(source.replace(ANDROID_ONLY, ""));

const captionShown = (): Map<string, boolean | "per platform"> => {
  const shown = new Map<string, boolean | "per platform">();
  for (const suite of yamlIn(SUITES).map((name) => path.join(SUITES, name))) {
    const conditional = new Set(
      [...readFileSync(suite, "utf8").matchAll(/file: ([\w./-]+)\n {4}when:\n/g)].map(
        ([, flow = ""]) => path.resolve(SUITES, flow),
      ),
    );
    let anywhere = false;
    let everywhere = false;
    for (const flow of references(suite)) {
      shown.set(path.basename(flow), everywhere ? false : !anywhere || "per platform");
      const source = readFileSync(flow, "utf8");
      if (DISMISSES_CAPTION.test(source)) {
        anywhere = true;
        everywhere ||= !conditional.has(flow) && dismissesEverywhere(source);
      }
    }
  }
  return shown;
};

const MATRIX_SUITE = "$" + "{{ matrix.suite }}";

const iosSuites = (): string[] =>
  readWorkflowJobs(repositoryPath(".github/workflows/ci.yml"))
    .filter(({ body }) => body.includes("runs-on: macos"))
    .flatMap(({ body }) => {
      const shards = body.match(/^\s+suite: \[(.*)\]$/m)?.[1]?.split(", ") ?? [];
      return [...body.matchAll(/\.maestro\/ci\/[\w${}. -]+\.yaml/g)].flatMap(([suite]) =>
        suite.includes(MATRIX_SUITE)
          ? shards.map((shard) => suite.replace(MATRIX_SUITE, shard))
          : [suite],
      );
    })
    .map((suite) => repositoryPath(suite));

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

  it("names the permissions of every launch that keeps the install", () => {
    const sweeping = readdirSync(MAESTRO, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".yaml"))
      .filter((name) =>
        launches(readFileSync(path.join(MAESTRO, name), "utf8")).some(sweepsPermissions),
      );

    expect(sweeping).toEqual([]);
  });

  it("signs in on iOS from the install the lane prepared, as each suite's first flow only", () => {
    const ios = [...readFileSync(CONNECT, "utf8").matchAll(IOS_ONLY)].flatMap(([block]) =>
      launches(block),
    );
    const suites = iosSuites();
    const late = suites.flatMap((suite) =>
      references(suite)
        .slice(1)
        .filter(signsIn)
        .map((flow) => `${path.basename(suite)}: ${path.basename(flow)}`),
    );

    expect(ios).toEqual([expect.not.stringMatching(/clear(?:State|Keychain): true/)]);
    expect(suites.length).toBeGreaterThan(0);
    expect(suites.every((suite) => signsIn(suite))).toBe(true);
    expect(late).toEqual([]);
  });

  it("keeps every Up Next capture in the caption state it was taken in", () => {
    const shown = captionShown();

    expect(
      Object.fromEntries(Object.keys(CAPTION_SHOWN).map((flow) => [flow, shown.get(flow)])),
    ).toEqual(CAPTION_SHOWN);
  });
});
