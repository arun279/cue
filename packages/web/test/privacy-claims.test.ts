import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import type { Token } from "@cue/core/domain/model/token";
import { REMINDER_WINDOW_DAYS } from "@cue/core/domain/reminders";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import androidManifestSource from "../../../android/app/src/main/AndroidManifest.xml?raw";
import extractionRulesSource from "../../../android/app/src/main/res/xml/data_extraction_rules.xml?raw";
import capacitorConfig from "../../../capacitor.config";
import servedPolicy from "../../../docs/index.html?raw";
import infoPlistSource from "../../../ios/App/App/Info.plist?raw";
import policy from "../../../PRIVACY.md?raw";
import readme from "../../../README.md?raw";
import runtimeSource from "../../core/src/app/create-runtime.ts?raw";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  import.meta.glob<string>("../../../android/app/src/*/AndroidManifest.xml", {
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
  // A `tools:node="remove"` entry is the opposite of a request: it strips a
  // permission a plugin's own manifest would otherwise merge in. So the two
  // kinds are pinned separately, and both exactly. The pattern deliberately does
  // not require a self-closing tag: `<uses-permission ...></uses-permission>`
  // declares exactly the same thing and must not be able to hide from this.
  const permissionElements = [...androidManifest.matchAll(/<uses-permission\b[^>]*>/g)].map(
    ([element]) => element,
  );
  const namesWhere = (keep: (element: string) => boolean): string[] =>
    permissionElements
      .filter(keep)
      .flatMap((element) => element.match(/\bandroid:name="([^"]+)"/)?.[1] ?? []);
  const isRemoval = (element: string): boolean => /\btools:node="remove"/.test(element);

  it("declares no Android permission of its own beyond INTERNET", () => {
    expect(namesWhere((element) => !isRemoval(element))).toEqual(["android.permission.INTERNET"]);
  });

  it("strips the exact-alarm permission a plugin would otherwise merge in", () => {
    expect(namesWhere(isRemoval)).toEqual(["android.permission.SCHEDULE_EXACT_ALARM"]);
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

  it("takes the local fake Trakt's origin only from a mock-mode build", async () => {
    const standIn = "http://127.0.0.1:8787";
    vi.stubEnv("VITE_TRAKT_API_BASE", standIn);
    try {
      for (const [mode, override] of [
        ["production", undefined],
        ["mock", standIn],
      ] as const) {
        vi.stubEnv("MODE", mode);
        vi.resetModules();
        expect((await import("@app/config")).TRAKT_BASE_OVERRIDE, mode).toBe(override);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
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
  "A backup taken by an earlier build of Cue may still sit in your Google account",
  "iOS keeps app preferences, your Trakt token among them, in a store that is included in a device backup by default, and Cue has not moved the token off that store yet",
  "That switch does not reach a backup stored on a computer, so delete that one yourself.",
  "up to fourteen notifications the operating system holds on Cue's behalf: one each morning, naming what airs that day",
  "Turning the switch off, or signing out, cancels all of them",
  "cancels every reminder the OS was holding for Cue",
  "Neither reaches a copy already sitting in a device backup",
  "Cue cannot delete it. Cue has no account of its own and no server-side copy of your data to delete.",
];

const readmeClaims = [
  "anything you have marked that has not synced yet",
  "on Android Cue opts out of Google backup and of Android's own device-to-device transfer",
  "on iOS Cue has not moved the token off the preferences store yet, which a device backup includes by default",
];

describe("privacy copy agreement and storage anchors", () => {
  it.each(claims)("keeps both policy copies in agreement: %s", (claim) => {
    expect(policyText).toContain(claim);
    expect(servedText).toContain(claim);
  });

  it.each(readmeClaims)("keeps the README summary pinned: %s", (claim) => {
    expect(readmeText).toContain(claim);
  });

  it("pins the revoke-Cue link to app.trakt.tv/settings/apps, not the dead /applications route", () => {
    const occurrences = (text: string) => text.split("app.trakt.tv/settings/apps").length - 1;
    expect(occurrences(policyText), "PRIVACY.md").toBe(3);
    expect(occurrences(servedText), "docs/index.html").toBe(3);
    expect(policy).not.toContain("settings/applications");
    expect(servedPolicy).not.toContain("settings/applications");
  });

  it("anchors unsynced marks to the persisted operation log", () => {
    expect(
      runtime,
      "Unsynced marks must remain in the persisted cue.write-queue operation log.",
    ).toMatch(
      /const\s+OP_LOG_KEY\s*=\s*["']cue\.write-queue["'];[\s\S]*?const\s+([A-Za-z_$][\w$]*)\s*=\s*createJsonStore(?:<[^>]*>)?\(\s*[\w.]+,\s*OP_LOG_KEY,[\s\S]*?\1\.write\(\s*queue\.snapshot\(\)\s*\)/,
    );
  });

  it("anchors the fourteen held notifications to the window the planner reaches over", () => {
    // One digest per day, so the ceiling the policy promises is the window
    // itself. A wider window would put more of the user's shows on the OS's
    // side than the policy accounts for.
    expect(REMINDER_WINDOW_DAYS).toBe(14);
  });

  it("anchors the iOS backup claim to the native token backend", async () => {
    const staleClaim =
      "The Trakt token no longer reaches Capacitor Preferences on native, so the iOS " +
      '"store included in backup by default" claim is stale. Update PRIVACY.md, README.md, ' +
      "and docs/index.html.";

    // Force the composition root down its native path. `registerPlugin` is
    // there for the haptics seam, which the root also builds on this path.
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { getPlatform: () => "ios" },
      registerPlugin: () => ({}),
    }));
    // providers.tsx also reads the native app version on this path, and
    // back-button.ts registers a hardware-back listener through the same
    // plugin. This anchor is about the token store, not either of those, so
    // stub both instead of letting the real web shim reject "Not implemented".
    vi.doMock("@capacitor/app", () => ({
      App: {
        getInfo: vi.fn(async () => ({ version: "1.0", build: "1" })),
        addListener: vi.fn(async () => ({ remove: async () => {} })),
        toggleBackButtonHandler: vi.fn(async () => {}),
      },
    }));

    // The one point of observation: whatever the real store ends up being, a
    // connected token must round-trip through this mock to count as reaching
    // the OS-backed Preferences store.
    const nativeBacking = new Map<string, string>();
    vi.doMock("@capacitor/preferences", async () => {
      const { createPreferencesMock } = await import("./support/capacitor-preferences-mock");
      return createPreferencesMock(nativeBacking);
    });
    // The query-cache persister also touches idb-keyval; stub it so mounting
    // the composition root never reaches for real IndexedDB.
    vi.doMock("idb-keyval", () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
    }));

    const token: Token = {
      access_token: "behavioral-anchor-access",
      refresh_token: "behavioral-anchor-refresh",
      created_at: 1_700_000_000,
      expires_in: 7_776_000,
    };
    // Short-circuit the device-code round trip: only the persist step, not
    // Trakt's network protocol, is what this test is anchoring.
    vi.doMock("@cue/core/data/auth/oauth", () => ({
      requestDeviceCode: vi.fn(async () => ({
        userCode: "ABCD1234",
        verificationUrl: "https://trakt.tv/activate",
        deviceCode: "device-code",
        intervalMs: 1,
      })),
      pollDeviceToken: vi.fn(async () => ({ status: "success" as const, token })),
      buildAuthorizeUrl: vi.fn(),
      exchangeCodeForToken: vi.fn(),
      revokeToken: vi.fn(),
    }));
    vi.doMock("@cue/core/data/auth/pkce", () => ({
      createPkcePair: vi.fn(async () => ({ verifier: "verifier", challenge: "challenge" })),
    }));

    // AuthGate is the one seam between the composition root and the screen it
    // renders: replacing it with a prop-capturing stub gets us the exact
    // `AuthStore` `src/app/providers.tsx` built and wired, without needing the
    // router or the onboarding screen it would otherwise mount. The store is
    // picked out of the props by shape (the one value with a `getState`
    // method), not by a hardcoded prop name, so renaming that prop is not a
    // wiring change this anchor can mistake for a storage regression.
    type AuthStoreLike = { getState: () => { connectWithDeviceCode: () => Promise<void> } };
    const isAuthStoreLike = (value: unknown): value is AuthStoreLike =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { getState?: unknown }).getState === "function";

    function requireAuthStore(store: AuthStoreLike | null): AuthStoreLike {
      if (store === null) {
        throw new Error("src/app/providers.tsx did not render AuthGate with an auth store.");
      }
      return store;
    }

    let capturedStore: AuthStoreLike | null = null;
    vi.doMock("@app/AuthGate", () => ({
      AuthGate: (props: Record<string, unknown>) => {
        capturedStore = Object.values(props).find(isAuthStoreLike) ?? null;
        return null;
      },
    }));

    vi.resetModules();
    const { AppProviders } = await import("@app/providers");
    const { Preferences } = await import("@capacitor/preferences");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(AppProviders)));

      const authStore = requireAuthStore(capturedStore);

      await act(async () => {
        await authStore.getState().connectWithDeviceCode();
      });

      expect(Preferences.set, staleClaim).toHaveBeenCalledWith({
        key: "cue.trakt.token",
        value: expect.any(String),
      });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
