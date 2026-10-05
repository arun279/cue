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
    { cwd: native, env: { ...process.env, ...release } },
  );
  return (JSON.parse(stdout) as { runtimeVersion: string }).runtimeVersion;
};

const production = (
  JSON.parse(readFileSync(repositoryPath("packages/native/eas.json"), "utf8")) as {
    build: { production: { channel: string; environment: string } };
  }
).build.production;
const publishedChannel = /eas update --channel (\S+)/.exec(publishWorkflow)?.[1];
const promotedTo = /eas update:republish --group "\$GROUP" --destination-channel (\S+)/.exec(
  publishWorkflow,
)?.[1];

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
    expect(publishWorkflow).not.toContain("REQUIRED:");
    expect(releaseWorkflow).not.toContain("REQUIRED:");
  });

  it("uses the release bundle's public environment", () => {
    expect(publicEnvironmentNames(publishWorkflow)).toEqual(
      publicEnvironmentNames(releaseWorkflow),
    );
  });

  it("publishes exactly the export that passed the store-bundle gate", () => {
    const exported = publishWorkflow.indexOf(
      `eas env:exec ${production.environment} --non-interactive`,
    );
    const gated = publishWorkflow.indexOf("run: node scripts/check-store-bundle.mjs");
    const published = publishWorkflow.indexOf("eas update ");

    expect(publishWorkflow).toContain("EXPO_ATLAS=true npx expo export --output-dir dist");
    expect([exported, gated, published].every((index) => index >= 0)).toBe(true);
    expect(exported < gated && gated < published).toBe(true);
    expect(publishWorkflow.slice(published)).toContain(
      `--environment ${production.environment} --skip-bundler --input-dir dist\n`,
    );
    expect(publishWorkflow.match(/eas update /g)).toHaveLength(1);
  });

  it("promotes a chosen update group from the channel it publishes to onto the channel store builds listen on", () => {
    expect(publishedChannel).toBeDefined();
    expect(publishedChannel).not.toBe(production.channel);
    expect(publishWorkflow).toContain(`[ "$branch" = ${publishedChannel} ]`);
    expect(promotedTo).toBe(production.channel);
  });

  it("binds builds to the fingerprint runtime and leaves the channel to the build profile", () => {
    const config = nativeAppConfig({});

    expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(config.updates?.url).toMatch(/^https:\/\/u\.expo\.dev\/[0-9a-f-]+$/);
    expect(config.updates?.checkAutomatically).toBe("ON_LOAD");
    expect(config.updates?.fallbackToCacheTimeout).toBe(0);
    expect(config.updates).not.toHaveProperty("requestHeaders");
  });

  it("gives every channel's store builds the runtime that updates are published against", {
    timeout: 30_000,
  }, async () => {
    const runtimes = (release: Record<string, string | undefined>) =>
      Promise.all(["ios", "android"].map((platform) => runtimeVersion(platform, release)));
    const [published, ...builds] = await Promise.all([
      runtimes({ APP_VERSION: undefined, BUILD_NUMBER: undefined }),
      ...[publishedChannel, production.channel].map((channel) =>
        runtimes({
          APP_VERSION: "2.1.0",
          BUILD_NUMBER: "420701",
          EAS_BUILD_PROFILE: channel,
          EAS_UPDATE_CHANNEL: channel,
        }),
      ),
    ]);

    for (const build of builds) {
      expect(build).toEqual(published);
    }
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
