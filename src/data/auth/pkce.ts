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
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes → a 43-char base64url verifier (within RFC 7636's 43-128 range). */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** A fresh verifier paired with its S256 challenge, ready for one auth attempt. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createCodeVerifier();
  return { verifier, challenge: await deriveCodeChallenge(verifier) };
}
