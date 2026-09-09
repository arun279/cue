import type { CryptoPort } from "@cue/core/ports/crypto";

export const webCrypto: CryptoPort = {
  newId: () => crypto.randomUUID(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  digest: async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
};
