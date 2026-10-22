import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { normalizeOptionsAsync } from "@expo/fingerprint/build/Options";
import { getExpoConfigSourcesAsync } from "@expo/fingerprint/build/sourcer/Expo";
import { describe, expect, it, vi } from "vitest";
import { nativeAppConfig } from "../../packages/native/app.config";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const publishWorkflow = readFileSync(
  repositoryPath(".github/workflows/publish-update.yml"),
  "utf8",
);
const MOBILE_RELEASE = repositoryPath(".github/workflows/mobile-release.yml");
const releaseWorkflow = readFileSync(MOBILE_RELEASE, "utf8");

const native = repositoryPath("packages/native");
const { getConfig } = createRequire(`${native}/package.json`)("expo/config");

const releaseConfigSources = async (release: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(release)) vi.stubEnv(name, value);
  const config = getConfig(native, { skipSDKVersionRequirement: true });
  vi.unstubAllEnvs();
  return Promise.all(
    (["ios", "android"] as const).map(async (platform) =>
      getExpoConfigSourcesAsync(
        native,
        config,
        [],
        await normalizeOptionsAsync(native, { platforms: [platform] }),
      ),
    ),
  );
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
    for (const workflow of [publishWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("CI_RUN_ID: $" + "{{ inputs.ci_run_id }}");
      expect(workflow).toContain("CODEQL_RUN_ID: $" + "{{ inputs.codeql_run_id }}");
      for (const input of ["ci_run_id", "codeql_run_id"]) {
        expect(workflow).toMatch(
          new RegExp(`^ {6}${input}:\n(?: {8}.*\n)*? {8}required: true\n`, "m"),
        );
      }
      expect(workflow).toMatch(/^ {2}gate:\n(?: {4}.*\n)*? {4}timeout-minutes: 5\n/m);
    }
  });

  it.each([
    "ios",
    "android",
  ])("checks the %s store bundle for the UI harness before building", (leg) => {
    const steps = (
      readWorkflowJobs(MOBILE_RELEASE).find(({ name }) => name === leg)?.body ?? ""
    ).split(/^ {6}- /m);
    const check = steps.findIndex((step) => step.includes("check-store-bundle.mjs"));
    const build = steps.findIndex((step) => step.includes("eas build --local"));

    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(build);
    expect(steps[check]).toContain(`eas env:exec ${production.environment} --non-interactive`);
    expect(steps[check]).toMatch(
      new RegExp(
        `EXPO_ATLAS=true npx expo export .*--platform ${leg} .*\\n {10}node \\.\\./\\.\\./scripts/check-store-bundle\\.mjs \\.expo/atlas\\.jsonl\\n`,
      ),
    );
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

  it("gives every channel's store builds the runtime that updates are published against", async () => {
    const published = await releaseConfigSources({
      APP_VERSION: undefined,
      BUILD_NUMBER: undefined,
    });

    for (const channel of [publishedChannel, production.channel]) {
      expect(
        await releaseConfigSources({
          APP_VERSION: "2.1.0",
          BUILD_NUMBER: "420701",
          EAS_BUILD_PROFILE: channel,
          EAS_UPDATE_CHANNEL: channel,
        }),
      ).toEqual(published);
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
