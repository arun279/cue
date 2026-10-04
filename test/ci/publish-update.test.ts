import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { nativeAppConfig } from "../../packages/native/app.config";
import { repositoryPath } from "../support/repository-path";

const publishWorkflow = readFileSync(
  repositoryPath(".github/workflows/publish-update.yml"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  repositoryPath(".github/workflows/mobile-release.yml"),
  "utf8",
);

const native = repositoryPath("packages/native");
const expoUpdatesCli = createRequire(`${native}/package.json`).resolve("expo-updates/bin/cli.js");

const execFileAsync = promisify(execFile);

const runtimeVersion = async (platform: string, release: Record<string, string | undefined>) => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [expoUpdatesCli, "runtimeversion:resolve", "--platform", platform],
    { cwd: native, env: { ...process.env, EAS_UPDATE_CHANNEL: "preview", ...release } },
  );
  return (JSON.parse(stdout) as { runtimeVersion: string }).runtimeVersion;
};

const publicEnvironmentNames = (workflow: string): string[] =>
  [
    ...new Set(
      [...workflow.matchAll(/^\s+(EXPO_PUBLIC_[A-Z0-9_]+):/gm)].flatMap((match) => match[1] ?? []),
    ),
  ].sort();

describe("JavaScript update publishing", () => {
  it("can only be started by manual dispatch", () => {
    const triggers = publishWorkflow.slice(
      publishWorkflow.indexOf("on:"),
      publishWorkflow.indexOf("concurrency:"),
    );

    expect(triggers).toContain("workflow_dispatch:");
    expect(triggers).not.toMatch(/^\s{2}(?:push|pull_request|schedule):/m);
  });

  it("requires the same exact-SHA CI gate as native releases", () => {
    expect(publishWorkflow).toContain("needs: gate");
    expect(publishWorkflow).toMatch(/SHA: \$\{\{ github\.sha \}\}/);
    expect(publishWorkflow).toContain("run: scripts/require-green-ci.sh");
    expect(releaseWorkflow).toContain("run: scripts/require-green-ci.sh");
  });

  it("uses the release bundle's public environment", () => {
    expect(publicEnvironmentNames(publishWorkflow)).toEqual(
      publicEnvironmentNames(releaseWorkflow),
    );
  });

  it("binds builds to the fingerprint runtime and an update channel", () => {
    const preview = nativeAppConfig({});
    const production = nativeAppConfig({ EAS_UPDATE_CHANNEL: "production" });

    expect(preview.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(preview.updates?.url).toMatch(/^https:\/\/u\.expo\.dev\/[0-9a-f-]+$/);
    expect(preview.updates?.checkAutomatically).toBe("ON_LOAD");
    expect(preview.updates?.fallbackToCacheTimeout).toBe(0);
    expect(preview.updates?.requestHeaders).toEqual({ "expo-channel-name": "preview" });
    expect(production.updates?.requestHeaders).toEqual({ "expo-channel-name": "production" });
  });

  it("gives store builds the runtime that updates are published against", {
    timeout: 30_000,
  }, async () => {
    const runtimes = (release: Record<string, string | undefined>) =>
      Promise.all(["ios", "android"].map((platform) => runtimeVersion(platform, release)));
    const [published, store] = await Promise.all([
      runtimes({ APP_VERSION: undefined, BUILD_NUMBER: undefined }),
      runtimes({ APP_VERSION: "2.1.0", BUILD_NUMBER: "420701" }),
    ]);

    expect(store).toEqual(published);
  });

  it("keeps analytics packages out of the native app", () => {
    const manifest = JSON.parse(
      readFileSync(repositoryPath("packages/native/package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const packages = { ...manifest["dependencies"], ...manifest["devDependencies"] };
    const denied = ["expo-insights", "expo-observe", "@expo/insights", "@expo/observe"];

    expect(denied.filter((name) => name in packages)).toEqual([]);
  });
});
