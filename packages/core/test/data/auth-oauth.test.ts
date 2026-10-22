import {
  type OAuthConfig,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  revokeToken,
  TRAKT_API_BASE,
} from "@cue/core/data/auth/oauth";
import { TokenRefresher } from "@cue/core/domain/auth/token";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();

const config: OAuthConfig = {
  clientId: "cid",
  redirectUri: "https://app.example/auth/callback",
};

const token = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
};

/** Capture the JSON body posted to `/oauth/token`, replying with a valid token. */
function captureTokenPost(): () => Record<string, string> | undefined {
  let body: Record<string, string> | undefined;
  server.use(
    http.post(`${TRAKT_API_BASE}/oauth/token`, async ({ request }) => {
      body = (await request.json()) as Record<string, string>;
      return HttpResponse.json(token);
    }),
  );
  return () => body;
}

describe("refreshAccessToken", () => {
  it("posts the refresh grant with the client id and no secret, and parses the rotated token", async () => {
    const body = captureTokenPost();
    expect(await refreshAccessToken(config, "refresh-old")).toEqual(token);
    expect(body()).toMatchObject({
      refresh_token: "refresh-old",
      client_id: "cid",
      grant_type: "refresh_token",
    });
    expect(body()).not.toHaveProperty("client_secret");
  });

  it("throws on a non-2xx", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/token`, () => HttpResponse.json({}, { status: 500 })),
    );
    await expect(refreshAccessToken(config, "r")).rejects.toThrow(/500/);
  });

  it("single-flights concurrent refreshes through one /oauth/token call (refresher)", async () => {
    let calls = 0;
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/token`, async () => {
        calls += 1;
        await delay(10);
        return HttpResponse.json(token);
      }),
    );
    const refresher = new TokenRefresher((rt) => refreshAccessToken(config, rt));
    const [a, b] = await Promise.all([refresher.refresh(token), refresher.refresh(token)]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("revokeToken", () => {
  it("posts the token + client id (no secret) and tolerates an empty body", async () => {
    let body: Record<string, string> | undefined;
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/revoke`, async ({ request }) => {
        body = (await request.json()) as Record<string, string>;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(revokeToken(config, "access-abc")).resolves.toBeUndefined();
    expect(body).toMatchObject({ token: "access-abc", client_id: "cid" });
    expect(body).not.toHaveProperty("client_secret");
  });
});

describe("requestDeviceCode", () => {
  it("binds the flow with the S256 challenge (no secret), parses the code, and converts the interval to ms", async () => {
    let body: Record<string, string> | undefined;
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/code`, async ({ request }) => {
        body = (await request.json()) as Record<string, string>;
        return HttpResponse.json({
          device_code: "dev-1",
          user_code: "ABCD1234",
          verification_url: "https://trakt.tv/activate",
          expires_in: 600,
          interval: 5,
        });
      }),
    );
    const code = await requestDeviceCode(config, "challenge-1");
    expect(code).toEqual({
      deviceCode: "dev-1",
      userCode: "ABCD1234",
      verificationUrl: "https://trakt.tv/activate",
      intervalMs: 5000,
      expiresInMs: 600_000,
    });
    expect(body).toMatchObject({
      client_id: "cid",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
    });
    expect(body).not.toHaveProperty("client_secret");
  });

  it("throws on a non-2xx", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/code`, () =>
        HttpResponse.json({}, { status: 403 }),
      ),
    );
    await expect(requestDeviceCode(config, "c")).rejects.toThrow(/403/);
  });
});

describe("pollDeviceToken", () => {
  function respond(
    status: number,
    body: Record<string, unknown> = {},
  ): () => Record<string, string> | undefined {
    let captured: Record<string, string> | undefined;
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/token`, async ({ request }) => {
        captured = (await request.json()) as Record<string, string>;
        return HttpResponse.json(body, { status });
      }),
    );
    return () => captured;
  }

  it("posts the client id + PKCE verifier (no secret) and maps 200 to success", async () => {
    const body = respond(200, token);
    expect(await pollDeviceToken(config, "dev-1", "verifier-1")).toEqual({
      status: "success",
      token,
    });
    expect(body()).toMatchObject({ code: "dev-1", client_id: "cid", code_verifier: "verifier-1" });
    expect(body()).not.toHaveProperty("client_secret");
  });

  it.each([
    [400, "pending"],
    [429, "slow-down"],
    [418, "denied"],
    [410, "expired"],
  ] as const)("maps %i to %s", async (status, expected) => {
    respond(status);
    expect(await pollDeviceToken(config, "dev-1", "v")).toEqual({ status: expected });
  });

  it("maps an unexpected status to a hard error carrying the code", async () => {
    respond(404);
    expect(await pollDeviceToken(config, "dev-1", "v")).toEqual({ status: "error", code: 404 });
  });
});
