import {
  type OAuthConfig,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  revokeToken,
} from "@cue/core/data/auth/oauth";
import { TokenRefresher } from "@cue/core/domain/auth/token";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION } from "../trakt-fake/account.ts";
import { createTraktFake } from "../trakt-fake/fake.ts";

let now = 0;
const fake = createTraktFake({ clock: () => now });

const config: OAuthConfig = {
  clientId: "cid",
  redirectUri: "https://app.example/auth/callback",
  fetch: fake.fetch,
};

beforeEach(() => {
  now = Date.parse("2026-10-15T00:00:00.000Z");
  fake.reset();
});

const sentTo = (path: string) =>
  fake.requests.filter((request) => request.path === path).map((request) => request.body);

describe("refreshAccessToken", () => {
  it("posts the refresh grant with the client id and no secret, and parses the rotated token", async () => {
    const rotated = await refreshAccessToken(config, SESSION.refresh_token);
    expect(rotated).toMatchObject({ expires_in: 604_800, token_type: "bearer" });
    expect(rotated.access_token).not.toBe(SESSION.access_token);
    expect(rotated.refresh_token).not.toBe(SESSION.refresh_token);
    const settings = await fake.fetch("https://api.trakt.tv/users/settings", {
      headers: { authorization: `Bearer ${rotated.access_token}` },
    });
    expect(settings.status).toBe(200);
    const [body] = sentTo("/oauth/token");
    expect(body).toMatchObject({
      refresh_token: SESSION.refresh_token,
      client_id: "cid",
      grant_type: "refresh_token",
    });
    expect(body).not.toHaveProperty("client_secret");
  });

  it("throws on a non-2xx", async () => {
    fake.fail({ path: /^\/oauth\/token$/ }, 500);
    await expect(refreshAccessToken(config, SESSION.refresh_token)).rejects.toThrow(/500/);
  });

  it("reads a refresh token Trakt no longer knows as invalid_grant", async () => {
    await refreshAccessToken(config, SESSION.refresh_token);
    await expect(refreshAccessToken(config, SESSION.refresh_token)).rejects.toMatchObject({
      status: 400,
      code: "invalid_grant",
    });
  });

  it("single-flights concurrent refreshes through one /oauth/token call (refresher)", async () => {
    const refresher = new TokenRefresher((rt) => refreshAccessToken(config, rt));
    const token = fake.session();
    const [a, b] = await Promise.all([refresher.refresh(token), refresher.refresh(token)]);
    expect(sentTo("/oauth/token")).toHaveLength(1);
    expect(a).toEqual(b);
  });
});

describe("revokeToken", () => {
  it("posts the token + client id (no secret) and tolerates the empty body Trakt answers", async () => {
    await expect(revokeToken(config, SESSION.access_token)).resolves.toBeUndefined();
    const [body] = sentTo("/oauth/revoke");
    expect(body).toMatchObject({ token: SESSION.access_token, client_id: "cid" });
    expect(body).not.toHaveProperty("client_secret");
  });
});

describe("requestDeviceCode", () => {
  it("binds the flow with the S256 challenge (no secret), parses the code, and converts the interval to ms", async () => {
    const code = await requestDeviceCode(config, "challenge-1");
    expect(code).toMatchObject({
      verificationUrl: "https://auth.trakt.tv/activate",
      intervalMs: 6000,
      expiresInMs: 600_000,
    });
    expect(code.userCode).toHaveLength(8);
    const [body] = sentTo("/oauth/device/code");
    expect(body).toMatchObject({
      client_id: "cid",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
    });
    expect(body).not.toHaveProperty("client_secret");
  });

  it("throws on a non-2xx", async () => {
    fake.fail({ path: /^\/oauth\/device\/code$/ }, 403);
    await expect(requestDeviceCode(config, "c")).rejects.toThrow(/403/);
  });
});

describe("pollDeviceToken", () => {
  async function started(): Promise<string> {
    return (await requestDeviceCode(config, "challenge")).deviceCode;
  }

  const poll = (code: string) => pollDeviceToken(config, code, "verifier-1");
  const later = (seconds: number): void => {
    now += seconds * 1000;
  };

  it("posts the client id + PKCE verifier (no secret) and maps an approved poll to success", async () => {
    const code = await started();
    fake.approve();
    const result = await poll(code);
    expect(result).toMatchObject({ status: "success", token: { expires_in: 604_800 } });
    const [body] = sentTo("/oauth/device/token");
    expect(body).toMatchObject({ code, client_id: "cid", code_verifier: "verifier-1" });
    expect(body).not.toHaveProperty("client_secret");
  });

  it("maps a poll nobody has approved yet, answered 400 with an empty body, to pending", async () => {
    expect(await poll(await started())).toEqual({ status: "pending" });
  });

  it("maps a poll faster than the interval to slow-down", async () => {
    const code = await started();
    await poll(code);
    later(1);
    expect(await poll(code)).toEqual({ status: "slow-down" });
  });

  it("maps a refused code to denied", async () => {
    const code = await started();
    fake.deny();
    expect(await poll(code)).toEqual({ status: "denied" });
  });

  it("maps a code past its lifetime to expired", async () => {
    const code = await started();
    later(601);
    expect(await poll(code)).toEqual({ status: "expired" });
  });

  it("maps an unknown code, and one already used, to a hard error carrying the status", async () => {
    expect(await poll("never-issued")).toEqual({ status: "error", code: 404 });
    const code = await started();
    fake.approve();
    await poll(code);
    later(6);
    expect(await poll(code)).toEqual({ status: "error", code: 409 });
  });
});
