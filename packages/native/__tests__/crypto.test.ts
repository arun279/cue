import { createHash } from "node:crypto";
import { installWebCrypto } from "../src/crypto";

const mockDigestedWith: string[] = [];

// Stands in for the native module, which no runner has. Node's digest behind it
// so the bytes the shim hands back can be checked against a known answer rather
// than against itself.
jest.mock("expo-crypto", () => ({
  digest: (algorithm: string, data: Uint8Array) => {
    mockDigestedWith.push(algorithm);
    const hash = require("node:crypto").createHash("sha256").update(data).digest();
    return Promise.resolve(new Uint8Array(hash).buffer);
  },
  getRandomValues: (values: Uint8Array) => values,
  randomUUID: () => "an-install",
}));

/**
 * The shim's own digest path, which nothing else reaches.
 *
 * `installWebCrypto` assigns with `??=`, and both jest projects run on a Node
 * that already has `globalThis.crypto`, so every other test in this package
 * exercises Node's implementation and would keep passing if the expo-crypto
 * delegation were broken. Installing over an empty object is what forces the
 * shim to be the thing that runs. It matters because the Capacitor migration
 * digests the legacy token on every cold boot, before anything is drawn: a shim
 * that does not take is a rejected boot for exactly the upgrading users that
 * migration exists for.
 */
describe("the Web Crypto shim", () => {
  it("digests through expo-crypto on an engine that has no Web Crypto", async () => {
    const engine: Record<string, unknown> = {};

    installWebCrypto(engine);
    const digested = await (engine["crypto"] as Crypto).subtle.digest(
      "SHA-256",
      new TextEncoder().encode("a-legacy-token"),
    );

    // The algorithm names Web Crypto and expo-crypto use have to be the same
    // string, because `crypto.ts` casts one to the other rather than mapping it.
    expect(mockDigestedWith).toEqual(["SHA-256"]);
    expect(new Uint8Array(digested)).toEqual(
      new Uint8Array(createHash("sha256").update("a-legacy-token").digest()),
    );
  });
});
