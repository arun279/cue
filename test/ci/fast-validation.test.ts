import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
const job = (name: string) =>
  workflow.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|(?![\\s\\S]))`, "m"),
  )?.[1] ?? "";

describe("fast pull request validation", () => {
  it("gates each native build on its platform fingerprint", () => {
    const fingerprint = job("fingerprint");
    const ios = job("native-ios");
    const android = job("native-android");

    expect(fingerprint).toContain("node scripts/native-fingerprint.mjs ios");
    expect(fingerprint).toContain("node scripts/native-fingerprint.mjs android");
    expect(ios).toContain("needs: fingerprint");
    expect(ios).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(ios).toContain("if: steps.native-cache.outputs.hit == 'true'");
    expect(android).toContain("needs: fingerprint");
    expect(android).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(android).toContain("if: steps.native-cache.outputs.hit == 'true'");
    expect(android).toContain("--build-cache --configuration-cache bundleRelease");
    expect(android).toContain("-PreactNativeArchitectures=arm64-v8a,x86_64");
    expect(android).toContain("--build-cache --configuration-cache assembleRelease");
    expect(android).not.toContain("bundleRelease assembleRelease");
    expect(android).toContain("lib/x86_64/lib" + "react" + "native\\.so");
  });

  it("keeps every build command out of footprint", () => {
    const footprint = job("footprint");

    expect(footprint).not.toMatch(/expo (?:export|prebuild)/);
    expect(footprint).not.toContain("grad" + "lew");
    expect(footprint).not.toMatch(/(?:xcodebuild|measure-play-size)/);
    expect(footprint).toContain("cue-native-ios-sizes");
    expect(footprint).toContain("cue-native-android-sizes");
    expect(footprint).toContain("cue-js-bundles");
  });

  it("uses a fixed Maestro driver port outside Android's ephemeral range", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification.match(/--driver-host-port 7001/g)).toHaveLength(2);
  });
});
