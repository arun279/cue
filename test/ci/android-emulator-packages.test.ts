import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const IMAGE = "system-images;android-35;default;x86_64";

const table = (title: string, rows: string[][]) =>
  [
    `${title}:`,
    "  Path                                    | Version | Description",
    "  -------                                 | ------- | -------",
    ...rows.map((row) => `  ${row.map((cell) => cell.padEnd(40)).join("| ")}`),
    "",
  ].join("\n");

const AVAILABLE = table("Available Packages", [
  ["emulator", "37.2.12", "Android Emulator"],
  ["system-images;android-35;default;arm64-v8a", "3", "ARM 64 v8a System Image"],
  [IMAGE, "2", "Intel x86_64 Atom System Image"],
]);

const tools = fakeBin({
  sdkmanager: `#!/bin/sh
echo "$*" >> "$ANDROID_HOME/calls"
case $1 in
  --list) cat "$ANDROID_HOME/list" ;;
  --list_installed) cat "$ANDROID_HOME/installed" ;;
  --install) [ -z "$INSTALL_FAILS" ] || { echo "Warning: An error occurred while preparing SDK package Intel x86_64 Atom System Image: Error on ZipFile unknown archive."; exit 1; } ;;
esac
`,
});

const sdkmanager = (outputs: { list?: string; installed?: string; installs?: boolean }) => {
  const home = tempDirectory("cue-android-sdk-");
  mkdirSync(path.join(home, "cmdline-tools/latest"), { recursive: true });
  symlinkSync(tools, path.join(home, "cmdline-tools/latest/bin"));
  writeFileSync(path.join(home, "list"), outputs.list ?? "");
  writeFileSync(path.join(home, "installed"), outputs.installed ?? "");
  return (...args: string[]) => {
    const result = spawnSync(
      "bash",
      [repositoryPath("scripts/android-emulator-packages.sh"), ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ANDROID_HOME: home,
          INSTALL_FAILS: outputs.installs === false ? "1" : "",
        },
      },
    );
    return { ...result, calls: readFileSync(path.join(home, "calls"), "utf8") };
  };
};

it("resolves the revisions Google serves now, not the ones installed", () => {
  const run = sdkmanager({
    list: `${table("Installed packages", [["emulator", "36.1.9", "Android Emulator", "emulator"]])}\n${AVAILABLE}`,
  });
  const result = run("revisions");

  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("emulator=37.2.12\nsystem-image=2\n");
  expect(result.calls).toBe("--list --channel=0\n");
});

it("fails at once when the SDK repository listing lacks either package", () => {
  const result = sdkmanager({ list: "Warning: Failed to download any source lists!\n" })(
    "revisions",
  );

  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`offers no emulator or ${IMAGE}`);
});

it("installs both packages and accepts them at the resolved revisions", () => {
  const run = sdkmanager({
    installed: table("Installed packages", [
      ["emulator", "37.2.12", "Android Emulator"],
      [IMAGE, "2", "Intel x86_64 Atom System Image"],
    ]),
  });
  const result = run("install", "37.2.12", "2");

  expect(result.status).toBe(0);
  expect(result.calls).toBe(`--install emulator ${IMAGE} --channel=0\n--list_installed\n`);
});

it("names the failed download instead of leaving the emulator step to find no image", () => {
  const result = sdkmanager({ installs: false })("install", "37.2.12", "2");

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `sdkmanager could not download and unpack the emulator and ${IMAGE}`,
  );
  expect(result.calls).not.toContain("--list_installed");
});

it.each([
  ["37.3.1", "2", "emulator 37.3.1 and IMAGE 2"],
  ["37.2.12", "3", "emulator 37.2.12 and IMAGE 3"],
  ["37.2.12", undefined, "emulator 37.2.12 and IMAGE nothing"],
])("refuses to cache emulator %s and system image %s when the key names 37.2.12 and 2", (emulator, image, installed) => {
  const run = sdkmanager({
    installed: table("Installed packages", [
      ["emulator", emulator, "Android Emulator"],
      ...(image === undefined ? [] : [[IMAGE, image, "Intel x86_64 Atom System Image"]]),
    ]),
  });
  const result = run("install", "37.2.12", "2");

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `installed ${installed.replace("IMAGE", IMAGE)}, not the 37.2.12 and 2 this job resolved`,
  );
});
