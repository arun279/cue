import type { CryptoPort } from "../../ports/crypto";

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(bytes: Uint8Array): string {
  const bits = Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join("");
  return bits.replace(/.{1,6}/g, (sextet) =>
    BASE64URL.charAt(Number.parseInt(sextet.padEnd(6, "0"), 2)),
  );
}

// RFC 7636 requires a 43 to 128 character verifier; 32 bytes encode to 43.
export function createCodeVerifier(crypto: CryptoPort): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

export async function deriveCodeChallenge(crypto: CryptoPort, verifier: string): Promise<string> {
  return base64UrlEncode(await crypto.digest(new TextEncoder().encode(verifier)));
}

export async function createPkcePair(crypto: CryptoPort): Promise<PkcePair> {
  const verifier = createCodeVerifier(crypto);
  return { verifier, challenge: await deriveCodeChallenge(crypto, verifier) };
}
