import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import { REMINDER_WINDOW_DAYS } from "@cue/core/domain/reminders";
import { describe, expect, it, vi } from "vitest";
import servedPolicy from "../../../docs/index.html?raw";
import policy from "../../../PRIVACY.md?raw";
import readme from "../../../README.md?raw";
import runtime from "../../core/src/app/create-runtime.ts?raw";
import storageKeys from "../../core/src/ports/storage-keys.ts?raw";

const servedText = servedPolicy
  .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&rarr;/g, "→")
  .replace(/\s+/g, " ");
const policyText = policy.replace(/\*\*/g, "").replace(/\s+/g, " ");
const readmeText = readme.replace(/\*\*/g, "").replace(/\s+/g, " ");

const claims = [
  "Everything Cue keeps is written to your device's own app storage:",
  "anything you have marked that has not reached Trakt yet",
  "Nothing Cue stores is included in a Google backup or carried over by Android's own device-to-device transfer",
  "A backup taken by an earlier build of Cue may still sit in your Google account",
  "iOS keeps app preferences, your Trakt token among them, in a store that is included in a device backup by default, and Cue has not moved the token off that store yet",
  "up to fourteen notifications the operating system holds on Cue's behalf: one each morning, naming what airs that day",
  "Turning the switch off, or signing out, cancels all of them",
  "Cue cannot delete it. Cue has no account of its own and no server-side copy of your data to delete.",
];

describe("privacy claims", () => {
  it.each(claims)("keeps both policy copies in agreement: %s", (claim) => {
    expect(policyText).toContain(claim);
    expect(servedText).toContain(claim);
  });

  it.each([
    "anything you have marked that has not synced yet",
    "on Android Cue opts out of Google backup and of Android's own device-to-device transfer",
    "on iOS Cue has not moved the token off the preferences store yet, which a device backup includes by default",
  ])("keeps the README summary pinned: %s", (claim) => {
    expect(readmeText).toContain(claim);
  });

  it("pins the current Trakt account links", () => {
    const occurrences = (text: string) => text.split("app.trakt.tv/settings/apps").length - 1;
    expect(occurrences(policyText), "PRIVACY.md").toBe(3);
    expect(occurrences(servedText), "docs/index.html").toBe(3);
    expect(policy).not.toContain("settings/applications");
    expect(servedPolicy).not.toContain("settings/applications");
  });

  it("anchors unsynced marks to the persisted operation log", () => {
    expect(storageKeys).toMatch(/export\s+const\s+OP_LOG_KEY\s*=\s*["']cue\.write-queue["']/);
    expect(runtime).toMatch(
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*createJsonStore(?:<[^>]*>)?\(\s*[\w.]+,\s*OP_LOG_KEY,[\s\S]*?\1\.write\(\s*queue\.snapshot\(\)\s*\)/,
    );
  });

  it("anchors the reminder ceiling to its planner window", () => {
    expect(REMINDER_WINDOW_DAYS).toBe(14);
  });

  it("talks directly to Trakt and limits endpoint overrides to mock mode", async () => {
    expect(TRAKT_API_BASE).toBe("https://api.trakt.tv");
    vi.stubEnv("VITE_TRAKT_API_BASE", "http://127.0.0.1:8787");
    try {
      for (const [mode, override] of [
        ["production", undefined],
        ["mock", "http://127.0.0.1:8787"],
      ] as const) {
        vi.stubEnv("MODE", mode);
        vi.resetModules();
        expect((await import("@app/config")).TRAKT_BASE_OVERRIDE).toBe(override);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
