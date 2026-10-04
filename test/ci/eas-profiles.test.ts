import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

type Profile = Record<string, unknown> & {
  distribution?: string;
  channel?: string;
  environment?: string;
  node?: string;
  pnpm?: string;
};

const read = (file: string): string => readFileSync(repositoryPath(file), "utf8");

const easJson = read("packages/native/eas.json");
const profiles = Object.entries((JSON.parse(easJson) as { build: Record<string, Profile> }).build);
const rootManifest = JSON.parse(read("package.json")) as {
  packageManager: string;
  engines: { node: string };
};
const postInstall = (
  JSON.parse(read("packages/native/package.json")) as { scripts: Record<string, string> }
).scripts["eas-build-post-install"];
const publishWorkflow = read(".github/workflows/publish-update.yml");
const publishChannels = /^\s+options: \[(.+)\]$/m.exec(publishWorkflow)?.[1]?.split(", ") ?? [];

const runPostInstall = (clientId: string | undefined) =>
  spawnSync("sh", ["-c", postInstall ?? ""], {
    env: {
      PATH: process.env["PATH"],
      ...(clientId === undefined ? {} : { EXPO_PUBLIC_TRAKT_CLIENT_ID: clientId }),
    },
  }).status;

describe("EAS device builds", () => {
  it("only distribute internally, so no build enters a store's build number sequence", () => {
    expect(profiles.length).toBeGreaterThan(0);
    for (const [, profile] of profiles) {
      expect(profile.distribution).toBe("internal");
    }
  });

  it("listen on a channel Publish update serves, in the environment it publishes with", () => {
    expect(publishWorkflow).toContain('--environment "$CHANNEL"');
    for (const [, profile] of profiles) {
      expect(publishChannels).toContain(profile.channel);
      expect(profile.environment).toBe(profile.channel);
    }
  });

  it("take every value from EAS environments, which builds and updates share", () => {
    expect(easJson).not.toMatch(/"env"|EXPO_PUBLIC_/);
  });

  it("install with the workspace's Node and pnpm", () => {
    for (const [, profile] of profiles) {
      expect(profile.node).toBe(rootManifest.engines.node);
      expect(`pnpm@${profile.pnpm}`).toBe(rootManifest.packageManager);
    }
  });

  it("stop before compiling when the environment has no Trakt client id", () => {
    expect(runPostInstall(undefined)).not.toBe(0);
    expect(runPostInstall("")).not.toBe(0);
    expect(runPostInstall("client")).toBe(0);
  });
});
