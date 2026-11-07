import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildMarkMovieOp } from "@/core/domain/write-queue/ops";
import { migrateLegacyData } from "@/core/migration/legacy-capacitor";
import type { LegacyStore } from "@/core/ports/legacy-store";
import { createTokenStore } from "@/core/ports/token-store";
import { buildRuntime } from "../data/_runtime";
import { memoryKeyValueStore, memoryLegacyStore, memoryPreferenceStorage } from "../support/stores";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

/**
 * A boot whose migration fails still reaches the app: the composition root
 * reports the failure and builds the session from whatever token the store
 * holds, and the runtime sends the queue it finds as it starts.
 */
it("sends a legacy op once when removing it from the legacy store fails and the app carries on", async () => {
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
  async function launch(legacyStore: LegacyStore): Promise<void> {
    const tokenStore = createTokenStore(secure);
    await migrateLegacyData({
      digest: async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
      legacy: legacyStore,
      tokenStore,
      secure,
      bulk,
      preferences: memoryPreferenceStorage(),
    }).catch(() => {});
    const token = await tokenStore.read();
    if (token === null) throw new Error("the adopted token did not reach the session");
    const runtime = await buildRuntime({ token, tokenStore, kv: bulk });
    await runtime.flushWrites();
  }

  await launch({ ...legacy, remove: () => Promise.reject(new Error("legacy store unavailable")) });
  await launch(legacy);

  const applied = fake.requests.filter(
    (request) =>
      request.method === "POST" && request.path === "/sync/history" && request.status < 300,
  );
  expect(applied).toHaveLength(1);
});
