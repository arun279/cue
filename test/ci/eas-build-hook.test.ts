import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const postInstall = (
  JSON.parse(readFileSync(repositoryPath("packages/native/package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts["eas-build-post-install"];

const runPostInstall = (clientId: string | undefined) =>
  spawnSync("sh", ["-c", postInstall ?? ""], {
    env: {
      PATH: process.env["PATH"],
      ...(clientId === undefined ? {} : { EXPO_PUBLIC_TRAKT_CLIENT_ID: clientId }),
    },
  }).status;

it("stops an EAS build before compiling when the environment has no Trakt client id", () => {
  expect(runPostInstall(undefined)).not.toBe(0);
  expect(runPostInstall("")).not.toBe(0);
  expect(runPostInstall("client")).toBe(0);
});
