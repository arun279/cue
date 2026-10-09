import { createHash } from "node:crypto";
import { nativeCrypto } from "../src/crypto";

const mockDigestedWith: string[] = [];

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: (algorithm: string, data: Uint8Array<ArrayBuffer>) => {
    mockDigestedWith.push(algorithm);
    return Promise.resolve(
      require("node:crypto").createHash("sha256").update(data).digest().buffer,
    );
  },
  getRandomValues: (values: Uint8Array<ArrayBuffer>) => values,
  randomUUID: () => "an-id",
}));

it("provides ids, random bytes, and SHA-256 through expo-crypto", async () => {
  expect(nativeCrypto.newId()).toBe("an-id");
  expect(nativeCrypto.randomBytes(32)).toHaveLength(32);
  expect(await nativeCrypto.digest(new TextEncoder().encode("a-legacy-token"))).toEqual(
    new Uint8Array(createHash("sha256").update("a-legacy-token").digest()),
  );
  expect(mockDigestedWith).toEqual(["SHA-256"]);
});
