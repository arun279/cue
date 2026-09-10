import type { CryptoPort } from "../../ports/crypto";

/**
 * OAuth 2.0 PKCE (RFC 7636) for the public Trakt client. The
 * `code_verifier` is a high-entropy random string kept on this device; the
 * `code_challenge` (its S256 digest) is what travels to Trakt's authorize
 * endpoint. Proving possession of the verifier at token exchange replaces the
 * confidential client secret a browser app can't safely hold.
 */
export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** Base64url (RFC 4648 section 5, no padding): the encoding PKCE mandates. */
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64URL[first >> 2];
    encoded += BASE64URL[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) encoded += BASE64URL[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) encoded += BASE64URL[third & 63];
  }
  return encoded;
}

/** 32 random bytes → a 43-char base64url verifier (within RFC 7636's 43-128 range). */
export function createCodeVerifier(crypto: CryptoPort): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/** S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export async function deriveCodeChallenge(crypto: CryptoPort, verifier: string): Promise<string> {
  return base64UrlEncode(await crypto.digest(new TextEncoder().encode(verifier)));
}

/** A fresh verifier paired with its S256 challenge, ready for one auth attempt. */
export async function createPkcePair(crypto: CryptoPort): Promise<PkcePair> {
  const verifier = createCodeVerifier(crypto);
  return { verifier, challenge: await deriveCodeChallenge(crypto, verifier) };
}
