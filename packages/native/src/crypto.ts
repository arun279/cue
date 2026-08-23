import { fromByteArray } from "base64-js";
import { type CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";

/**
 * The Web Crypto surface `@cue/core` expects, on an engine that has none of it.
 *
 * `data/auth/pkce.ts` reads `crypto.getRandomValues`, `crypto.subtle.digest` and
 * `btoa`, and `auth/create-auth-store.ts` reads `crypto.randomUUID`. All four
 * are browser globals with no Hermes equivalent. Rather than fork the core for
 * one platform, the platform is given the globals the core was written against:
 * that is what keeps the OAuth implementation one file both targets run.
 *
 * A dedicated module rather than a React component, because installing globals
 * from a render is a side effect at a moment nothing controls; and a plain
 * function rather than an import-order side effect, because organize-imports is
 * free to move a bare import and nothing would notice until first sign-in.
 *
 * Nothing already present is replaced. Hermes and Expo's own runtime keep
 * gaining standard globals, and the day one of these arrives for real the
 * platform's implementation is the one that should win.
 *
 * `TextEncoder` is deliberately not shimmed. `pkce.ts` uses it too, but a
 * hand-written UTF-8 encoder is exactly the kind of code that is right until it
 * meets a non-latin1 input, and there is nothing here worth being wrong about
 * quietly: if an engine ever lacks it, the failure should be a crash at the
 * first sign-in rather than a challenge that hashes the wrong bytes.
 */
export function installWebCrypto(target: Record<string, unknown>): void {
  target["btoa"] ??= (binary: string): string =>
    fromByteArray(Uint8Array.from(binary, (character) => character.charCodeAt(0)));

  const crypto = (target["crypto"] ?? {}) as Record<string, unknown>;
  crypto["getRandomValues"] ??= getRandomValues;
  crypto["randomUUID"] ??= randomUUID;
  crypto["subtle"] ??= {};
  const subtle = crypto["subtle"] as Record<string, unknown>;
  subtle["digest"] ??= (algorithm: string, data: BufferSource): Promise<ArrayBuffer> =>
    digest(algorithm as CryptoDigestAlgorithm, data);
  target["crypto"] ??= crypto;
}
