import type { Token } from "@domain/model/token";
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

const token: Token = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
};

describe.each([
  { name: "web (idb-keyval)", native: false, backing: webBacking },
  { name: "native (Preferences)", native: true, backing: nativeBacking },
])("token store on the $name backend", ({ native, backing }) => {
  beforeEach(() => {
    backing.clear();
  });

  it("round-trips a token and clears it", async () => {
    const store = createTokenStore(createKeyValueStore(native));

    expect(await store.read()).toBeNull();
    await store.write(token);
    expect(await store.read()).toEqual(token);

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("reads back null for a corrupt entry rather than throwing", async () => {
    const kv = createKeyValueStore(native);
    await kv.write("cue.trakt.token", "{ not json");

    expect(await createTokenStore(kv).read()).toBeNull();
  });
});
