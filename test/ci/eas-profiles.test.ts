import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

type Profile = Record<string, unknown> & {
  distribution?: string;
  channel?: string;
  environment?: string;
  autoIncrement?: boolean;
  credentialsSource?: string;
  node?: string;
  pnpm?: string;
};

const read = (file: string): string => readFileSync(repositoryPath(file), "utf8");

const easJson = read("packages/native/eas.json");
const eas = JSON.parse(easJson) as {
  cli: { appVersionSource?: string };
  build: Record<string, Profile>;
};
const profiles = Object.entries(eas.build);
const rootManifest = JSON.parse(read("package.json")) as {
  packageManager: string;
  engines: { node: string };
};
const postInstall = (
  JSON.parse(read("packages/native/package.json")) as { scripts: Record<string, string> }
).scripts["eas-build-post-install"];
const publishWorkflow = read(".github/workflows/publish-update.yml");
const releaseWorkflow = read(".github/workflows/mobile-release.yml");
const promotedChannel = /--destination-channel (\S+)/.exec(publishWorkflow)?.[1];

const runPostInstall = (clientId: string | undefined) =>
  spawnSync("sh", ["-c", postInstall ?? ""], {
    env: {
      PATH: process.env["PATH"],
      ...(clientId === undefined ? {} : { EXPO_PUBLIC_TRAKT_CLIENT_ID: clientId }),
    },
  }).status;

describe("EAS device builds", () => {
  it("are the store builds the release workflow ships, numbered by EAS's remote counter", () => {
    expect(profiles.map(([name]) => name)).toEqual(["production"]);
    expect(eas.cli.appVersionSource).toBe("remote");
    for (const [name, profile] of profiles) {
      expect(profile.distribution).toBe("store");
      expect(profile.autoIncrement).toBe(true);
      expect(releaseWorkflow).toContain(`--profile ${name}`);
    }
  });

  it("sign with the credentials the release workflow writes from repository secrets", () => {
    for (const [, profile] of profiles) {
      expect(profile.credentialsSource).toBe("local");
    }
    expect(releaseWorkflow.match(/> credentials\.json$/gm)).toHaveLength(2);
    expect(read(".gitignore")).toMatch(/^\/packages\/native\/credentials\.json$/m);
  });

  it("listen on the channel updates are promoted to, in the environment updates are exported with", () => {
    for (const [, profile] of profiles) {
      expect(profile.channel).toBe(promotedChannel);
      expect(publishWorkflow).toContain(`eas env:exec ${profile.environment} `);
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
