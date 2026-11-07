import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildMarkMovieOp } from "@/core/domain/write-queue/ops";
import { migrateLegacyData } from "@/core/migration/legacy-capacitor";
import type { LegacyStore } from "@/core/ports/legacy-store";
import { createTokenStore } from "@/core/ports/token-store";
import { buildRuntime } from "../data/_runtime";
import {
  type MemoryKeyValueStore,
  memoryKeyValueStore,
  memoryLegacyStore,
  memoryPreferenceStorage,
} from "../support/stores";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

const ADOPTED_OPS = "cue.legacy-ops-adopted";

/**
 * A boot whose migration fails still reaches the app: the composition root
 * reports the failure and builds the session from whatever token the store
 * holds, and the runtime sends the queue it finds as it starts. The first
 * launch fails the way each case names; the relaunch has working storage.
 */
async function appliedAfterRelaunch(
  failFirstLaunch: (stores: { legacy: LegacyStore; bulk: MemoryKeyValueStore }) => {
    legacy: LegacyStore;
    bulk: MemoryKeyValueStore;
  },
): Promise<number> {
  const secure = memoryKeyValueStore();
  const bulk = memoryKeyValueStore();
  const legacy = memoryLegacyStore({
    "cue.trakt.token": JSON.stringify(fake.session()),
    "cue.write-queue": JSON.stringify([
      buildMarkMovieOp({
        opId: "legacy-mark",
        ids: { trakt: 5503 },
        watchedAt: new Date(FIXTURE_NOW).toISOString(),
      }),
    ]),
  });
  async function launch(stores: { legacy: LegacyStore; bulk: MemoryKeyValueStore }) {
    const tokenStore = createTokenStore(secure);
    await migrateLegacyData({
      digest: async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
      legacy: stores.legacy,
      tokenStore,
      secure,
      bulk: stores.bulk,
      preferences: memoryPreferenceStorage(),
    }).catch(() => {});
    const token = await tokenStore.read();
    if (token === null) throw new Error("the adopted token did not reach the session");
    const runtime = await buildRuntime({ token, tokenStore, kv: bulk });
    await runtime.flushWrites();
  }

  await launch(failFirstLaunch({ legacy, bulk }));
  await launch({ legacy, bulk });

  return fake.requests.filter(
    (request) =>
      request.method === "POST" && request.path === "/sync/history" && request.status < 300,
  ).length;
}

it("sends a legacy op once when removing it from the legacy store fails", async () => {
  const applied = await appliedAfterRelaunch(({ legacy, bulk }) => ({
    legacy: { ...legacy, remove: () => Promise.reject(new Error("legacy store unavailable")) },
    bulk,
  }));
  expect(applied).toBe(1);
});

it("sends a legacy op once when the record of adopting it cannot be written", async () => {
  const applied = await appliedAfterRelaunch(({ legacy, bulk }) => {
    // Once the record fails, so does the next op log write the migration makes.
    let failing = false;
    const full = () => Promise.reject(new Error("disk full"));
    return {
      legacy,
      bulk: {
        ...bulk,
        write: (key: string, value: string) => {
          if (key === ADOPTED_OPS) failing = true;
          if (key === ADOPTED_OPS || (failing && key === "cue.write-queue")) return full();
          return bulk.write(key, value);
        },
        writeAll: (entries: Readonly<Record<string, string>>) =>
          ADOPTED_OPS in entries ? full() : bulk.writeAll(entries),
      },
    };
  });
  expect(applied).toBe(1);
});
