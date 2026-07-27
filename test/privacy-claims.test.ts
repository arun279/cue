import { TRAKT_API_BASE } from "@data/trakt/client";
import { describe, expect, it } from "vitest";
import androidManifestSource from "../android/app/src/main/AndroidManifest.xml?raw";
import extractionRulesSource from "../android/app/src/main/res/xml/data_extraction_rules.xml?raw";
import capacitorConfig from "../capacitor.config";
import servedPolicy from "../docs/index.html?raw";
import infoPlistSource from "../ios/App/App/Info.plist?raw";
import policy from "../PRIVACY.md?raw";
import readme from "../README.md?raw";
import providersSource from "../src/app/providers.tsx?raw";
import runtimeSource from "../src/app/runtime/create-runtime.ts?raw";
import kvSource from "../src/platform/kv.ts?raw";

/**
 * The native shells are the one part of this repo nothing else reads: biome,
 * dprint, cspell and dependency-cruiser all skip `ios/` and `android/`, and
 * tsconfig excludes them. Cue's published privacy policy makes claims that only
 * hold if those shells are configured a particular way, so each claim is pinned
 * here to the shipped file that makes it true. The policy and its served copy
 * are checked against each other for the same reason: a claim corrected in one
 * and not the other is how the two drifted apart in the first place.
 *
 * Everything is imported rather than read from disk so paths resolve against
 * this module instead of the working directory vitest happened to start in.
 */

/** Comments quote the very attributes and APIs asserted below, so they must not count either way. */
const stripComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

const androidManifest = stripComments(androidManifestSource);
const extractionRules = stripComments(extractionRulesSource);
const infoPlist = stripComments(infoPlistSource);
const kv = stripComments(kvSource);
const providers = stripComments(providersSource);
const runtime = stripComments(runtimeSource);

/** Every storage domain Android's backup rules can name, device-protected ones included. */
const backupDomains = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

const ruleSection = (name: string): string =>
  extractionRules.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

/** Domains a section drops wholesale. A narrower `path` protects one file and leaks the rest. */
const domainsExcludedWholesale = (section: string): string[] =>
  [...section.matchAll(/<exclude\b[^>]*>/g)]
    .map(([element]) => element)
    .filter((element) => /\bpath="\."/.test(element))
    .flatMap((element) => element.match(/\bdomain="([^"]+)"/)?.[1] ?? []);

/** A variant overlay outranks `main` in the merged manifest, so it must not touch any of these. */
const postureAttributes = [
  "allowBackup",
  "dataExtractionRules",
  "fullBackupContent",
  "usesCleartextTraffic",
  "networkSecurityConfig",
  "uses-permission",
];

const variantManifests = Object.entries(
  import.meta.glob<string>("../android/app/src/*/AndroidManifest.xml", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).filter(([path]) => !path.includes("/main/"));

describe("claim: nothing Cue stores is copied off an Android device", () => {
  // Several assertions below are negative, and a `?raw` import that resolved to
  // an empty string would satisfy every one of them without reading anything.
  it.each([
    ["the Android manifest", androidManifest],
    ["the extraction rules", extractionRules],
    ["the iOS Info.plist", infoPlist],
    ["the policy", policy],
    ["the served policy", servedPolicy],
  ])("actually loaded %s", (_name, source) => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("keeps the app out of Google backup and adb backup", () => {
    expect(androidManifest).toMatch(/android:allowBackup\s*=\s*"false"/);
  });

  it("points at the rules that also cover device-to-device transfer", () => {
    expect(androidManifest).toMatch(
      /android:dataExtractionRules\s*=\s*"@xml\/data_extraction_rules"/,
    );
  });

  it.each(["cloud-backup", "device-transfer"])("excludes every storage domain from %s", (name) => {
    expect(domainsExcludedWholesale(ruleSection(name))).toEqual(
      expect.arrayContaining(backupDomains),
    );
  });

  it("adds no include rule, which would flip a section back to an allowlist", () => {
    expect(extractionRules).not.toContain("<include");
  });

  it("lets no build variant overlay the posture main declares", () => {
    for (const [path, manifest] of variantManifests) {
      for (const attribute of postureAttributes) {
        expect(stripComments(manifest), path).not.toContain(attribute);
      }
    }
  });
});

describe("claim: Cue collects nothing and reaches Trakt directly over HTTPS", () => {
  it("declares no Android permission of its own beyond INTERNET", () => {
    const declared = [...androidManifest.matchAll(/<uses-permission\b[^>]*>/g)].flatMap(
      ([element]) => element.match(/\bandroid:name="([^"]+)"/)?.[1] ?? [],
    );
    expect(declared).toEqual(["android.permission.INTERNET"]);
  });

  it("declares no iOS usage description, because Cue asks for no protected data", () => {
    expect(infoPlist).not.toMatch(/NS\w+UsageDescription/);
  });

  it("serves the app from the bundle rather than a remote origin", () => {
    expect(capacitorConfig.server).toBeUndefined();
  });

  it("talks to Trakt itself and not to a host standing in for it", () => {
    expect(TRAKT_API_BASE).toBe("https://api.trakt.tv");
  });

  it("permits no cleartext traffic on either platform", () => {
    expect(androidManifest).not.toMatch(/android:usesCleartextTraffic\s*=\s*"true"/);
    // A network security config or an ATS dictionary can re-admit cleartext per
    // domain, so the invariant is that neither platform declares one at all.
    expect(androidManifest).not.toContain("networkSecurityConfig");
    expect(infoPlist).not.toContain("NSAppTransportSecurity");
  });
});

/** Normalize the privacy copies enough for stable source-text assertions. */
const servedText = servedPolicy
  .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&rarr;/g, "→")
  .replace(/\s+/g, " ");

const policyText = policy.replace(/\*\*/g, "").replace(/\s+/g, " ");
const readmeText = readme.replace(/\*\*/g, "").replace(/\s+/g, " ");

/**
 * These strings keep the repository and served policy copies aligned. Some
 * claims are anchored independently above or below; the rest catch document
 * drift only and do not verify the underlying behavior.
 */
const claims = [
  "Everything Cue keeps is written to your device's own app storage:",
  "anything you have marked that has not reached Trakt yet",
  "Nothing Cue stores is included in a Google backup or carried over by Android's own device-to-device transfer",
  "Versions of Cue before July 2026 did not opt out",
  "iOS keeps app preferences, your Trakt token among them, in a store that is included in a device backup by default, and Cue has not moved the token off that store yet",
  "That switch does not reach a backup stored on a computer, so delete that one yourself.",
  "Neither reaches a copy already sitting in a device backup",
];

const readmeClaims = [
  "anything you have marked that has not synced yet",
  "on Android Cue opts out of Google backup and of Android's own device-to-device transfer",
  "on iOS Cue does not yet opt out, since app preferences are included in a device backup by default",
];

describe("privacy copy agreement and storage anchors", () => {
  it.each(claims)("keeps both policy copies in agreement: %s", (claim) => {
    expect(policyText).toContain(claim);
    expect(servedText).toContain(claim);
  });

  it.each(readmeClaims)("keeps the README summary pinned: %s", (claim) => {
    expect(readmeText).toContain(claim);
  });

  it("anchors unsynced marks to the persisted operation log", () => {
    expect(
      runtime,
      "Unsynced marks must remain in the persisted cue.write-queue operation log.",
    ).toMatch(
      /const\s+OP_LOG_KEY\s*=\s*["']cue\.write-queue["'];[\s\S]*?const\s+([A-Za-z_$][\w$]*)\s*=\s*createJsonStore<QueuedOp\[\]>\(\s*deps\.kv,\s*OP_LOG_KEY,[\s\S]*?\1\.write\(\s*queue\.snapshot\(\)\s*\)/,
    );
  });

  it("anchors the iOS backup claim to the native token backend", () => {
    const staleClaim =
      'The iOS "store included in backup by default" claim is stale. Update PRIVACY.md, README.md, and docs/index.html.';
    const nativeKeyValueStore =
      kv.match(
        /^(?:export\s+)?function\s+nativeKeyValueStore\s*\([^)]*\)\s*:\s*KeyValueStore\s*\{[\s\S]*?^\}/m,
      )?.[0] ?? "";

    expect(
      nativeKeyValueStore,
      "Could not find the nativeKeyValueStore function body in src/platform/kv.ts.",
    ).not.toBe("");
    expect(kv, staleClaim).toMatch(
      /import\s*\{[^}]*\bPreferences\b[^}]*\}\s*from\s*["']@capacitor\/preferences["']/,
    );
    // An unused import could survive a backend rewrite, so every native
    // operation must still use Preferences.
    for (const method of ["get", "set", "remove"]) {
      expect(nativeKeyValueStore, staleClaim).toMatch(
        new RegExp(`\\bPreferences\\.${method}\\s*\\(`),
      );
    }
    expect(providers, staleClaim).toMatch(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*createKeyValueStore\s*\([^;]*\)\s*;[\s\S]*?\bconst\s+[A-Za-z_$][\w$]*\s*=\s*createTokenStore\s*\(\s*\1\s*\)\s*;/,
    );
  });
});
