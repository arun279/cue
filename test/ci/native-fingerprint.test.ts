import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT, repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/native-fingerprint.mjs");

const BUILD_ENVIRONMENT = {
  ANDROID_ARCHITECTURES: "arm64-v8a,x86_64",
  APP_VERSION: "9.9.9",
  BUILD_NUMBER: "42",
  CONFIGURATION: "Release",
  EXPO_PUBLIC_TRAKT_API_BASE: "http://127.0.0.1:8787",
  EXPO_PUBLIC_TRAKT_CLIENT_ID: "ci",
  XCODE_PATH: "/Applications/Xcode_26.6.app",
};

const project = () => {
  const directory = tempDirectory("cue-fingerprint-");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "fixture", scripts: { start: "expo start" } }),
    "ios/App/b.swift": "let b = 2\r\n",
    "ios/App/A.swift": "let a = 1\n",
    "android/settings.gradle": "include ':app'\n",
    "android/app/build.gradle": "android {}\r\n",
  };
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), contents);
  }
  return directory;
};

const fingerprint = (
  platform: string,
  projectRoot: string,
  env: Record<string, string | undefined> = {},
  cwd = REPOSITORY_ROOT,
) =>
  spawnSync(process.execPath, [SCRIPT, platform, projectRoot], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...BUILD_ENVIRONMENT, ...env },
  });

describe("native fingerprint", { timeout: 30_000 }, () => {
  it("hashes a fixed tree to the value recorded on macOS, wherever it is checked out", () => {
    const root = project();

    expect(fingerprint("ios", root).stdout).toBe("b94019081d7bbbf471768a2375c99bf75977a06a");
    expect(fingerprint("android", root).stdout).toBe("cbf0e2c0e54c524c4cfdfa038651bd325b8cbab0");
  });

  it("does not depend on the working or temporary directory", () => {
    const root = project();
    const elsewhere = tempDirectory("cue-fingerprint-cwd-");

    expect(fingerprint("ios", root, { TMPDIR: elsewhere }, elsewhere).stdout).toBe(
      fingerprint("ios", root).stdout,
    );
  });

  it("rebuilds Android, and only Android, when a bundled image changes", () => {
    const root = project();
    const before = {
      ios: fingerprint("ios", root).stdout,
      android: fingerprint("android", root).stdout,
    };
    mkdirSync(path.join(root, "src/ui"), { recursive: true });
    writeFileSync(path.join(root, "src/ui/refresh.xml"), "<vector />\n");

    expect(fingerprint("ios", root).stdout).toBe(before.ios);
    expect(fingerprint("android", root).stdout).not.toBe(before.android);
  });

  it("refuses to hash an unstated build environment", () => {
    const result = fingerprint("ios", project(), { XCODE_PATH: undefined });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("needs the build environment: XCODE_PATH");
  });
});
