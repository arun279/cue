import type { Credentials } from "@domain/model/credentials";
import type { Token } from "@domain/model/token";
import { createCredsStore } from "@platform/creds-store";
import { createJsonStore } from "@platform/json-store";
import { createKeyValueStore } from "@platform/kv";
import { createTokenStore } from "@platform/token-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: nativeBacking.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      nativeBacking.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      nativeBacking.delete(key);
    }),
  },
}));

interface Sample {
  a: number;
  b: string;
}

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

describe("concrete stores use distinct keys", () => {
  beforeEach(() => {
    webBacking.clear();
  });

  it("stores the token and creds under their own keys", async () => {
    const kv = createKeyValueStore(false);
    const token: Token = {
      access_token: "a",
      refresh_token: "r",
      created_at: 1_700_000_000,
      expires_in: 7_776_000,
    };
    const creds: Credentials = { clientId: "id", clientSecret: "secret", tmdbKey: "" };

    await createTokenStore(kv).write(token);
    await createCredsStore(kv).write(creds);

    expect(JSON.parse(webBacking.get("cue.trakt.token") ?? "null")).toEqual(token);
    expect(JSON.parse(webBacking.get("cue.trakt.creds") ?? "null")).toEqual(creds);
    expect(await createTokenStore(kv).read()).toEqual(token);
    expect(await createCredsStore(kv).read()).toEqual(creds);
  });

  it("reads back null when a persisted entry is valid JSON but the wrong shape", async () => {
    const kv = createKeyValueStore(false);
    // A migrated/partial token missing refresh_token, and creds missing tmdbKey.
    await kv.write("cue.trakt.token", JSON.stringify({ access_token: "only" }));
    await kv.write("cue.trakt.creds", JSON.stringify({ clientId: "id", clientSecret: "secret" }));

    expect(await createTokenStore(kv).read()).toBeNull();
    expect(await createCredsStore(kv).read()).toBeNull();
  });
});
