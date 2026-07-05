import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  type OAuthConfig,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  revokeToken,
  TRAKT_API_BASE,
} from "@data/auth/oauth";
import { TokenRefresher } from "@domain/auth/token";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();

const config: OAuthConfig = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://app.example/auth/callback",
};

const token = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
};

describe("buildAuthorizeUrl", () => {
  it("targets trakt.tv with the code flow params and state nonce", () => {
    const url = new URL(buildAuthorizeUrl(config, "nonce-1"));
    expect(url.origin + url.pathname).toBe("https://trakt.tv/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce-1");
  });

  it("honors an overridden site base", () => {
    const url = buildAuthorizeUrl({ ...config, siteBaseUrl: "https://staging.trakt.tv/" }, "n");
    expect(url.startsWith("https://staging.trakt.tv/oauth/authorize?")).toBe(true);
  });
});

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

describe("exchangeCodeForToken", () => {
  it("posts the auth-code grant and parses the token", async () => {
    const body = captureTokenPost();
    const result = await exchangeCodeForToken(config, "the-code");
    expect(result).toEqual(token);
    expect(body()).toMatchObject({
      code: "the-code",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
  });

  it("throws on a non-2xx (wrong secret)", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/token`, () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 401 }),
      ),
    );
    await expect(exchangeCodeForToken(config, "x")).rejects.toThrow(/401/);
  });

  it("throws on a malformed token body", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/token`, () => HttpResponse.json({ access_token: 1 })),
    );
    await expect(exchangeCodeForToken(config, "x")).rejects.toThrow();
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant and parses the rotated token", async () => {
    const body = captureTokenPost();
    expect(await refreshAccessToken(config, "refresh-old")).toEqual(token);
    expect(body()).toMatchObject({ refresh_token: "refresh-old", grant_type: "refresh_token" });
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
  it("posts the token + client creds and tolerates an empty body", async () => {
    let body: Record<string, string> | undefined;
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/revoke`, async ({ request }) => {
        body = (await request.json()) as Record<string, string>;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(revokeToken(config, "access-abc")).resolves.toBeUndefined();
    expect(body).toMatchObject({ token: "access-abc", client_id: "cid", client_secret: "secret" });
  });
});

describe("requestDeviceCode", () => {
  it("parses the device code and converts the interval to ms", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/code`, () =>
        HttpResponse.json({
          device_code: "dev-1",
          user_code: "ABCD1234",
          verification_url: "https://trakt.tv/activate",
          expires_in: 600,
          interval: 5,
        }),
      ),
    );
    const code = await requestDeviceCode(config);
    expect(code).toEqual({
      deviceCode: "dev-1",
      userCode: "ABCD1234",
      verificationUrl: "https://trakt.tv/activate",
      intervalMs: 5000,
    });
  });

  it("throws on a non-2xx", async () => {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/code`, () =>
        HttpResponse.json({}, { status: 403 }),
      ),
    );
    await expect(requestDeviceCode(config)).rejects.toThrow(/403/);
  });
});

describe("pollDeviceToken", () => {
  function respond(status: number, body: Record<string, unknown> = {}): void {
    server.use(
      http.post(`${TRAKT_API_BASE}/oauth/device/token`, () => HttpResponse.json(body, { status })),
    );
  }

  it("maps 200 to success with the parsed token", async () => {
    respond(200, token);
    expect(await pollDeviceToken(config, "dev-1")).toEqual({ status: "success", token });
  });

  it.each([
    [400, "pending"],
    [429, "slow-down"],
    [418, "denied"],
    [410, "expired"],
  ] as const)("maps %i to %s", async (status, expected) => {
    respond(status);
    expect(await pollDeviceToken(config, "dev-1")).toEqual({ status: expected });
  });

  it("maps an unexpected status to a hard error carrying the code", async () => {
    respond(404);
    expect(await pollDeviceToken(config, "dev-1")).toEqual({ status: "error", code: 404 });
  });
});
