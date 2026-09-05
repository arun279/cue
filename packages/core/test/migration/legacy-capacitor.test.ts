import { describe, expect, it } from "vitest";
import {
  type LegacyMigrationDeps,
  migrateLegacyCapacitorData,
} from "../../src/migration/legacy-capacitor";
import { createTokenStore } from "../../src/ports/token-store";
import {
  type MemoryKeyValueStore,
  memoryKeyValueStore,
  memoryPreferenceStorage,
} from "../support/stores";

const TOKEN = {
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
} as const;

const OP = {
  id: "op-1",
  itemKey: "episode:8802191",
  request: { method: "POST", path: "/sync/history", body: { episodes: [] } },
  inverse: { method: "POST", path: "/sync/history/remove", body: { episodes: [] } },
  inversePatch: { kind: "mark", showId: 8803, preCompleted: 3 },
  watchedAt: "2026-08-01T20:00:00.000Z",
  fromState: "absent",
  toState: "present",
  reconcileKeys: ["progress/watched", "watched/shows"],
} as const;

function deps(legacySeed: Record<string, string> = {}): LegacyMigrationDeps & {
  readonly legacy: MemoryKeyValueStore;
  readonly bulk: MemoryKeyValueStore;
  readonly preferences: ReturnType<typeof memoryPreferenceStorage>;
} {
  const bulk = memoryKeyValueStore();
  return {
    legacy: memoryKeyValueStore(legacySeed),
    tokenStore: createTokenStore(memoryKeyValueStore()),
    bulk,
    preferences: memoryPreferenceStorage(),
  };
}

/**
 * The migration is a pure function of what the Capacitor build left in its own
 * store, which is what makes every branch below a test rather than a device
 * session. The two that matter most are the ones with no visible symptom: a
 * token not adopted is a forced device-code re-login for every installed user,
 * and an op log not adopted is a play the user marked that never reaches Trakt.
 */
describe("the Capacitor migration", () => {
  it("does nothing on a fresh install", async () => {
    const fresh = deps();
    const result = await migrateLegacyCapacitorData(fresh);

    expect(result).toEqual({ adoptedToken: false, adoptedOps: 0 });
    expect(await fresh.tokenStore.read()).toBeNull();
    expect(fresh.bulk.values.size).toBe(0);
    expect(fresh.preferences.values.size).toBe(0);
  });

  it("adopts the legacy token once and leaves it where it is", async () => {
    const upgrade = deps({ "cue.trakt.token": JSON.stringify(TOKEN) });
    const result = await migrateLegacyCapacitorData(upgrade);
    const second = await migrateLegacyCapacitorData(upgrade);

    expect(result.adoptedToken).toBe(true);
    expect(second.adoptedToken).toBe(false);
    expect(await upgrade.tokenStore.read()).toEqual(TOKEN);
    // Left in place on purpose: a Capacitor build is still a rollback target,
    // and the rule that matches what a user expects is last writer wins.
    expect(upgrade.legacy.values.get("cue.trakt.token")).toBe(JSON.stringify(TOKEN));
  });

  it("adopts a changed legacy token", async () => {
    const upgrade = deps({ "cue.trakt.token": JSON.stringify(TOKEN) });
    await migrateLegacyCapacitorData(upgrade);
    const changed = JSON.stringify({ ...TOKEN, access_token: "changed" });
    upgrade.legacy.values.set("cue.trakt.token", changed);

    const result = await migrateLegacyCapacitorData(upgrade);

    expect(result.adoptedToken).toBe(true);
    expect(await upgrade.tokenStore.read()).toEqual({ ...TOKEN, access_token: "changed" });
    expect(upgrade.legacy.values.get("cue.trakt.token")).toBe(changed);
  });

  it("prefers the legacy token over one this install already holds", async () => {
    const rolledBackAndForward = deps({ "cue.trakt.token": JSON.stringify(TOKEN) });
    await rolledBackAndForward.tokenStore.write({ ...TOKEN, access_token: "stale" });

    await migrateLegacyCapacitorData(rolledBackAndForward);

    expect((await rolledBackAndForward.tokenStore.read())?.access_token).toBe("access");
  });

  it("seeds the first-mark caption as seen, because an install with a token has been used", async () => {
    const upgrade = deps({ "cue.trakt.token": JSON.stringify(TOKEN) });
    await migrateLegacyCapacitorData(upgrade);

    expect(upgrade.preferences.getItem("cue.tutorial-mark-dismissed")).toBe("1");
  });

  it("ignores a token the schema rejects rather than adopting half of one", async () => {
    const corrupt = deps({ "cue.trakt.token": JSON.stringify({ access_token: "only" }) });
    const result = await migrateLegacyCapacitorData(corrupt);

    expect(result.adoptedToken).toBe(false);
    expect(await corrupt.tokenStore.read()).toBeNull();
    expect(corrupt.preferences.values.size).toBe(0);
  });

  it("carries the op log across and removes it, so it can never replay twice", async () => {
    const pending = deps({
      "cue.trakt.token": JSON.stringify(TOKEN),
      "cue.write-queue": JSON.stringify([OP]),
    });
    const result = await migrateLegacyCapacitorData(pending);

    expect(result.adoptedOps).toBe(1);
    expect(JSON.parse(pending.bulk.values.get("cue.write-queue") ?? "null")).toEqual([OP]);
    expect(pending.legacy.values.has("cue.write-queue")).toBe(false);
  });

  it("drops an unparseable op rather than replaying it as a play nobody made", async () => {
    const mixed = deps({
      "cue.write-queue": JSON.stringify([OP, { id: "op-2" }, { ...OP, id: "op-3" }]),
    });
    const result = await migrateLegacyCapacitorData(mixed);

    expect(result.adoptedOps).toBe(2);
    expect(JSON.parse(mixed.bulk.values.get("cue.write-queue") ?? "null")).toEqual([
      OP,
      { ...OP, id: "op-3" },
    ]);
  });

  it("treats a corrupt op log as empty and still clears it", async () => {
    const corrupt = deps({ "cue.write-queue": "{ not json" });
    const result = await migrateLegacyCapacitorData(corrupt);

    expect(result.adoptedOps).toBe(0);
    expect(corrupt.bulk.values.size).toBe(0);
    expect(corrupt.legacy.values.has("cue.write-queue")).toBe(false);
  });

  it("puts migrated ops ahead of anything this install already queued", async () => {
    const both = deps({ "cue.write-queue": JSON.stringify([OP]) });
    const mine = { ...OP, id: "op-native" };
    await both.bulk.write("cue.write-queue", JSON.stringify([mine]));

    await migrateLegacyCapacitorData(both);

    expect(JSON.parse(both.bulk.values.get("cue.write-queue") ?? "null")).toEqual([OP, mine]);
  });

  it("is a no-op on the second launch", async () => {
    const upgrade = deps({ "cue.trakt.token": JSON.stringify(TOKEN) });
    await migrateLegacyCapacitorData({ ...upgrade, legacy: upgrade.legacy });
    const second = await migrateLegacyCapacitorData(upgrade);

    expect(second).toEqual({ adoptedToken: false, adoptedOps: 0 });
    expect(await upgrade.tokenStore.read()).toEqual(TOKEN);
  });

  it("does not migrate the freshness baseline, so the first poll establishes one", async () => {
    const upgrade = deps({
      "cue.trakt.token": JSON.stringify(TOKEN),
      "cue.last-activities": JSON.stringify({ all: "2026-08-01T00:00:00.000Z" }),
    });
    await migrateLegacyCapacitorData(upgrade);

    expect(upgrade.bulk.values.has("cue.last-activities")).toBe(false);
  });
});
