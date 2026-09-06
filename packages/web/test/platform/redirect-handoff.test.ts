/**
 * The `RedirectHandoff` adapter. What it uniquely owns: that the OAuth state
 * nonce and the PKCE verifier survive the full-page navigation to Trakt and
 * back, that a half-written handoff refuses rather than returning a partial
 * pair, and that both are single-use. Playwright cannot own this: the callback
 * leg it exercises never leaves the fixture.
 */

import { sessionRedirectHandoff } from "@platform/redirect-handoff";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("sessionRedirectHandoff", () => {
  it("hands back what was stashed before the redirect", () => {
    sessionRedirectHandoff.write("state-nonce", "pkce-verifier");
    expect(sessionRedirectHandoff.read()).toEqual({
      state: "state-nonce",
      verifier: "pkce-verifier",
    });
  });

  it("refuses when nothing was stashed", () => {
    expect(sessionRedirectHandoff.read()).toBeNull();
  });

  it("refuses a half-written handoff rather than returning a partial pair", () => {
    sessionRedirectHandoff.write("state-nonce", "pkce-verifier");
    for (const key of Object.keys(sessionStorage)) {
      if (sessionStorage.getItem(key) === "pkce-verifier") sessionStorage.removeItem(key);
    }
    expect(sessionRedirectHandoff.read()).toBeNull();
  });

  it("leaves nothing behind once the state is accepted", () => {
    sessionRedirectHandoff.write("state-nonce", "pkce-verifier");
    sessionRedirectHandoff.clear();
    expect(sessionRedirectHandoff.read()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("stashes per tab, so a closed tab abandons the attempt", () => {
    sessionRedirectHandoff.write("state-nonce", "pkce-verifier");
    expect(sessionStorage.length).toBe(2);
    expect(localStorage.length).toBe(0);
  });
});
