import { createCodeVerifier, createPkcePair, deriveCodeChallenge } from "@cue/core/data/auth/pkce";
import { describe, expect, it } from "vitest";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("createCodeVerifier", () => {
  it("returns a 43-char base64url string (32 bytes of entropy, no padding)", () => {
    const verifier = createCodeVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(BASE64URL);
  });

  it("is unpredictable across calls", () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
  });
});

describe("deriveCodeChallenge", () => {
  it("matches the RFC 7636 Appendix B S256 test vector", async () => {
    const challenge = await deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces a padding-free base64url digest", async () => {
    const challenge = await deriveCodeChallenge("any-verifier");
    expect(challenge).toMatch(BASE64URL);
    expect(challenge).not.toContain("=");
  });
});

describe("createPkcePair", () => {
  it("pairs a fresh verifier with its own S256 challenge", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(BASE64URL);
    expect(challenge).toBe(await deriveCodeChallenge(verifier));
  });
});
