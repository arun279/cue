import type { Token } from "@cue/core/domain/model/token";
import { createJsonStore } from "@cue/core/ports/json-store";
import { createTokenStore } from "@cue/core/ports/token-store";
import { createKeyValueStore } from "@platform/kv";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { webBacking, nativeBacking } = vi.hoisted(() => ({
  webBacking: new Map<string, string>(),
  nativeBacking: new Map<string, string>(),
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => webBacking.get(key)),
  set: vi.fn(async (key: string, value: string) => {
    webBacking.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    webBacking.delete(key);
  }),
}));

vi.mock("@capacitor/preferences", async () => {
  const { createPreferencesMock } = await import("../support/capacitor-preferences-mock");
  return createPreferencesMock(nativeBacking);
});

interface Sample {
  a: number;
  b: string;
}

// A tiny parse-guarded schema stands in for any validated JsonStore, proving the
// store rejects a wrong-shaped persisted entry (schema validation at the boundary).
const sampleSchema = z.object({ a: z.number(), b: z.string() });

describe.each([
  { name: "web (idb-keyval)", native: false, backing: webBacking },
  { name: "native (Preferences)", native: true, backing: nativeBacking },
])("createJsonStore on the $name backend", ({ native, backing }) => {
  beforeEach(() => {
    backing.clear();
  });

  it("round-trips a value and clears it", async () => {
    const store = createJsonStore<Sample>(createKeyValueStore(native), "sample");
    const value: Sample = { a: 1, b: "two" };

    expect(await store.read()).toBeNull();
    await store.write(value);
    expect(await store.read()).toEqual(value);

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("reads back null for a corrupt entry rather than throwing", async () => {
    const kv = createKeyValueStore(native);
    await kv.write("sample", "{ not json");
    expect(await createJsonStore<Sample>(kv, "sample").read()).toBeNull();
  });
});

describe("parse-guarded stores reject the wrong shape", () => {
  beforeEach(() => {
    webBacking.clear();
  });

  it("stores the token under its own key and round-trips it", async () => {
    const kv = createKeyValueStore(false);
    const token: Token = {
      access_token: "a",
      refresh_token: "r",
      created_at: 1_700_000_000,
      expires_in: 7_776_000,
    };

    await createTokenStore(kv).write(token);

    expect(JSON.parse(webBacking.get("cue.trakt.token") ?? "null")).toEqual(token);
    expect(await createTokenStore(kv).read()).toEqual(token);
  });

  it("reads back null when a persisted entry is valid JSON but the wrong shape", async () => {
    const kv = createKeyValueStore(false);
    const sampleStore = createJsonStore<Sample>(kv, "cue.sample", (v) => sampleSchema.parse(v));
    // A migrated/partial token missing refresh_token, and a sample missing `b`.
    await kv.write("cue.trakt.token", JSON.stringify({ access_token: "only" }));
    await kv.write("cue.sample", JSON.stringify({ a: 1 }));

    expect(await createTokenStore(kv).read()).toBeNull();
    expect(await sampleStore.read()).toBeNull();
  });
});
