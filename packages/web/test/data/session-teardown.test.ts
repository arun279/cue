/**
 * What sign-out has to leave behind, and what it must not.
 *
 * The op log, the freshness baseline and the persisted query cache are
 * account-scoped: anything of them surviving a sign-out can replay or repaint
 * under the next account on the same device. Preferences are device-local and
 * carry no account state. So a teardown step that fails must not be able to skip
 * the three that matter, which is what pins their order here.
 */

import { describe, expect, it } from "vitest";
import { buildRuntime, memoryKv } from "./_runtime";

const OP_LOG_KEY = "cue.write-queue";
const ACTIVITIES_KEY = "cue.last-activities";
const SEEDED_BASELINE = '{"episodes":{"watched_at":"2026-01-01T00:00:00Z"}}';

describe("endLocalSession", () => {
  it("leaves nothing of the account on the device", async () => {
    const kv = memoryKv({ [ACTIVITIES_KEY]: SEEDED_BASELINE });
    let cachesCleared = false;
    let preferencesCleared = false;
    const runtime = await buildRuntime({
      kv,
      clearPersistedCaches: async () => {
        cachesCleared = true;
      },
      clearLocalPreferences: () => {
        preferencesCleared = true;
      },
    });

    await runtime.endLocalSession();

    expect(kv.values.has(OP_LOG_KEY)).toBe(false);
    expect(kv.values.has(ACTIVITIES_KEY)).toBe(false);
    expect(cachesCleared).toBe(true);
    expect(preferencesCleared).toBe(true);
  });

  it("still clears the account state when the preference clear fails", async () => {
    const kv = memoryKv({ [ACTIVITIES_KEY]: SEEDED_BASELINE });
    let cachesCleared = false;
    const runtime = await buildRuntime({
      kv,
      clearPersistedCaches: async () => {
        cachesCleared = true;
      },
      clearLocalPreferences: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });

    await expect(runtime.endLocalSession()).rejects.toThrow(DOMException);

    expect(kv.values.has(OP_LOG_KEY)).toBe(false);
    expect(kv.values.has(ACTIVITIES_KEY)).toBe(false);
    expect(cachesCleared).toBe(true);
  });
});
