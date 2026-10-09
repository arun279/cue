import type { CryptoPort } from "@cue/core/ports/crypto";
import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";

export const nativeCrypto: CryptoPort = {
  newId: randomUUID,
  randomBytes: (length) => getRandomValues(new Uint8Array(length)),
  digest: async (bytes) => new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
};
