import { newestSyncedAt, syncedPhrase, syncStatusLine } from "@ui/screens/settings/sync-status";
import { describe, expect, it } from "vitest";

const NOW = 1_750_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("newestSyncedAt", () => {
  it("picks the newest successful read and ignores everything else", () => {
    expect(
      newestSyncedAt([
        { status: "success", dataUpdatedAt: NOW - HOUR },
        { status: "success", dataUpdatedAt: NOW - MINUTE },
        { status: "error", dataUpdatedAt: NOW },
        { status: "pending", dataUpdatedAt: 0 },
      ]),
    ).toBe(NOW - MINUTE);
  });

  it("reports 0 when nothing has loaded", () => {
    expect(newestSyncedAt([])).toBe(0);
    expect(newestSyncedAt([{ status: "pending", dataUpdatedAt: 0 }])).toBe(0);
  });
});

describe("syncedPhrase", () => {
  it("walks just now → minutes → hours → days, and owns the never case", () => {
    expect(syncedPhrase(0, NOW)).toBe("Not synced yet");
    expect(syncedPhrase(NOW - 30_000, NOW)).toBe("Last synced just now");
    expect(syncedPhrase(NOW - 2 * MINUTE, NOW)).toBe("Last synced 2 min ago");
    expect(syncedPhrase(NOW - 3 * HOUR, NOW)).toBe("Last synced 3 hr ago");
    expect(syncedPhrase(NOW - 26 * HOUR, NOW)).toBe("Last synced 1 day ago");
    expect(syncedPhrase(NOW - 50 * HOUR, NOW)).toBe("Last synced 2 days ago");
  });
});

describe("syncStatusLine", () => {
  it("composes the one full-sync-state line", () => {
    expect(syncStatusLine(NOW - 2 * MINUTE, 0, NOW)).toBe("Last synced 2 min ago · 0 pending");
    expect(syncStatusLine(NOW - 2 * MINUTE, 3, NOW)).toBe("Last synced 2 min ago · 3 pending");
  });
});
