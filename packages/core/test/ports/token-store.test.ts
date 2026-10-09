import type { Token } from "@cue/core/domain/model/token";
import type { KeyValueStore } from "@cue/core/ports/kv";
import { createTokenStore } from "@cue/core/ports/token-store";
import { afterEach, describe, expect, it, vi } from "vitest";

const TOKEN: Token = {
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
};
const ROTATED: Token = { ...TOKEN, access_token: "rotated", refresh_token: "rotated" };

/** A Keychain that answers only when the test says so, applying each call's effect then. */
function slowKeychain(seed: string | null = null) {
  let value = seed;
  const calls: { readonly settle: (outcome?: Error) => void }[] = [];
  const call = (effect: () => void) =>
    new Promise<void>((resolve, reject) => {
      calls.push({
        settle: (outcome) => {
          if (outcome !== undefined) return reject(outcome);
          effect();
          resolve();
        },
      });
    });
  const kv: KeyValueStore = {
    read: () => Promise.resolve(value),
    write: (_key, next) =>
      call(() => {
        value = next;
      }),
    remove: () =>
      call(() => {
        value = null;
      }),
  };
  return {
    kv,
    stored: () => (value === null ? null : (JSON.parse(value) as Token)),
    pending: () => calls.length,
    answer: async (outcome?: Error) => {
      await vi.advanceTimersByTimeAsync(0);
      calls.shift()?.settle(outcome);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe("the token store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers reads from memory while the Keychain is still saving", async () => {
    const keychain = slowKeychain(JSON.stringify(TOKEN));
    const tokens = createTokenStore(keychain.kv);

    void tokens.clear();
    expect(await tokens.read()).toBeNull();
    void tokens.write(ROTATED);
    expect(await tokens.read()).toEqual(ROTATED);
    expect(keychain.stored()).toEqual(TOKEN);
  });

  it("asks the Keychain again after it refused a read", async () => {
    const read = vi
      .fn<KeyValueStore["read"]>()
      .mockRejectedValueOnce(new Error("errSecInteractionNotAllowed"))
      .mockResolvedValueOnce(JSON.stringify(TOKEN));
    const tokens = createTokenStore({ ...slowKeychain().kv, read });

    await expect(tokens.read()).rejects.toThrow("errSecInteractionNotAllowed");
    expect(await tokens.read()).toEqual(TOKEN);
    expect(await tokens.read()).toEqual(TOKEN);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("saves a sign-in made during a slow delete after the delete, so the token survives", async () => {
    vi.useFakeTimers();
    const keychain = slowKeychain(JSON.stringify(TOKEN));
    const tokens = createTokenStore(keychain.kv);

    void tokens.clear();
    void tokens.write(ROTATED);
    await vi.advanceTimersByTimeAsync(0);
    expect(keychain.pending()).toBe(1);

    await keychain.answer();
    await keychain.answer();
    expect(keychain.stored()).toEqual(ROTATED);
  });

  it("tries a failed save again until it lands", async () => {
    vi.useFakeTimers();
    const keychain = slowKeychain();
    const tokens = createTokenStore(keychain.kv, 1_000);

    const saved = tokens.write(TOKEN);
    await keychain.answer(new Error("errSecInteractionNotAllowed"));
    await expect(saved).rejects.toThrow("errSecInteractionNotAllowed");
    await vi.advanceTimersByTimeAsync(1_000);
    await keychain.answer(new Error("errSecInteractionNotAllowed"));
    await vi.advanceTimersByTimeAsync(1_000);
    await keychain.answer();

    expect(keychain.stored()).toEqual(TOKEN);
  });

  it("drops the retry of a failed save once a newer token has been saved", async () => {
    vi.useFakeTimers();
    const keychain = slowKeychain();
    const tokens = createTokenStore(keychain.kv, 1_000);

    void tokens.write(TOKEN);
    await keychain.answer(new Error("errSecInteractionNotAllowed"));
    void tokens.write(ROTATED);
    await keychain.answer();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(keychain.pending()).toBe(0);
    expect(keychain.stored()).toEqual(ROTATED);
  });
});
