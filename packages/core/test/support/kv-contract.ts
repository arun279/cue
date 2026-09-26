import { beforeEach, describe, expect, it } from "vitest";
import { createJsonStore } from "../../src/ports/json-store";
import type { KeyValueStore } from "../../src/ports/kv";
import { createTokenStore } from "../../src/ports/token-store";

/**
 * One backend under test. `open` returns a store over the SAME durable backing
 * every time it is called, which is what lets the suite assert that a value
 * outlives the store object the way it has to outlive an app launch.
 */
export interface KeyValueBacking {
  readonly name: string;
  open(): KeyValueStore;
  reset(): Promise<void>;
}

const LONG = "x".repeat(200_000);
/**
 * One value per way a store can lose text. In order: Cyrillic, a Latin-1
 * Supplement ligature inside the quotes JSON has to escape, Japanese, one code
 * point outside the BMP (a surrogate pair in UTF-16), and the backslash and
 * whitespace a naive serializer eats. A backend that stores its values as
 * latin1, or that round-trips them through a lossy encoder, loses these
 * silently, and what it is losing is a show title or an OAuth token.
 */
const UNICODE = 'Привет "Cœur" 日本語 \u{1f3ac} \\ \n\t';

const TOKEN = {
  access_token: "a",
  refresh_token: "r",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
} as const;

/**
 * The contract every `KeyValueStore` has to satisfy, run against each backend
 * rather than asserted once against the one that happens to be in front of us.
 * This seam carries the OAuth token and the durable write queue, so a backend
 * that truncates a long value, mangles a non-latin1 one, throws instead of
 * answering `null`, or forgets across a restart loses a user's writes silently.
 */
export function describeKeyValueStore(backing: KeyValueBacking): void {
  describe(`the KeyValueStore contract on ${backing.name}`, () => {
    beforeEach(async () => {
      await backing.reset();
    });

    it("reads back exactly what was written", async () => {
      const store = backing.open();
      await store.write("cue.plain", "value");
      expect(await store.read("cue.plain")).toBe("value");
    });

    it("keeps a non-latin1 value byte for byte", async () => {
      const store = backing.open();
      await store.write("cue.unicode", UNICODE);
      expect(await store.read("cue.unicode")).toBe(UNICODE);
    });

    it("keeps a long value whole", async () => {
      const store = backing.open();
      await store.write("cue.long", LONG);
      expect(await store.read("cue.long")).toBe(LONG);
    });

    it("answers null for a key nothing wrote, rather than throwing", async () => {
      expect(await backing.open().read("cue.absent")).toBeNull();
    });

    it("keeps its keys apart", async () => {
      const store = backing.open();
      await store.write("cue.one", "1");
      await store.write("cue.two", "2");
      await store.remove("cue.one");
      expect(await store.read("cue.one")).toBeNull();
      expect(await store.read("cue.two")).toBe("2");
    });

    it("treats a second removal as done rather than as an error", async () => {
      const store = backing.open();
      await store.write("cue.gone", "value");
      await store.remove("cue.gone");
      await expect(store.remove("cue.gone")).resolves.toBeUndefined();
      expect(await store.read("cue.gone")).toBeNull();
    });

    it("overwrites in place", async () => {
      const store = backing.open();
      await store.write("cue.same", "first");
      await store.write("cue.same", "second");
      expect(await store.read("cue.same")).toBe("second");
    });

    it("survives the store being reopened, which is what an app launch is", async () => {
      await backing.open().write("cue.durable", UNICODE);
      expect(await backing.open().read("cue.durable")).toBe(UNICODE);
    });

    it("reads a corrupt JSON entry back as null through JsonStore", async () => {
      const store = backing.open();
      await store.write("cue.json", "{ not json");
      expect(await createJsonStore(store, "cue.json").read()).toBeNull();
    });

    it("round-trips the token and refuses a wrong-shaped one", async () => {
      const store = backing.open();
      await createTokenStore(store).write(TOKEN);
      expect(await createTokenStore(store).read()).toEqual(TOKEN);

      await store.write("cue.trakt.token", JSON.stringify({ access_token: "only" }));
      expect(await createTokenStore(store).read()).toBeNull();
    });
  });
}
