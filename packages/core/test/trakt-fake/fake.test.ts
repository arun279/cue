import { describe, expect, it } from "vitest";
import { FIXTURE_NOW } from "./account.ts";
import { createTraktFake } from "./fake.ts";

/**
 * What the fake does that no recording can show, as Trakt documents it: token
 * lifetime, the device token statuses, and the rate limits. Everything recorded
 * is checked by conformance.test.ts.
 */

const MINUTE = 60_000;

function fakeAt() {
  let now = FIXTURE_NOW;
  const fake = createTraktFake({ clock: () => now });
  const send = (method: "GET" | "POST", path: string, body?: object, token?: string) =>
    fake.fetch(`https://api.trakt.tv${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token ?? fake.session().access_token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const advance = (ms: number): void => {
    now += ms;
  };
  return { fake, send, advance };
}

const mark = { episodes: [{ ids: { trakt: 880120 } }] };

describe("sessions (https://docs.trakt.tv/reference/postoauthdevicetoken)", () => {
  it("refuses an access token once its 7 days are up", async () => {
    const { send, advance } = fakeAt();
    advance(7 * 24 * 60 * MINUTE - 1);
    expect((await send("GET", "/users/settings")).status).toBe(200);
    advance(1);
    const refused = await send("GET", "/users/settings");
    expect([refused.status, await refused.text()]).toEqual([401, "Unauthorized"]);
  });

  it("answers each refresh token once", async () => {
    const { fake, send } = fakeAt();
    const refresh = { grant_type: "refresh_token", refresh_token: fake.session().refresh_token };
    expect((await send("POST", "/oauth/token", refresh)).status).toBe(200);
    const reused = await send("POST", "/oauth/token", refresh);
    expect([reused.status, await reused.json()]).toEqual([
      400,
      { error: "invalid_grant", error_description: "session not found" },
    ]);
  });
});

describe("the device token poll answers every documented status", () => {
  async function polled() {
    const { fake, send, advance } = fakeAt();
    const code = (await (await send("POST", "/oauth/device/code", {})).json()) as {
      device_code: string;
    };
    const poll = async (deviceCode = code.device_code) =>
      (await send("POST", "/oauth/device/token", { code: deviceCode })).status;
    return { fake, advance, poll, send };
  }

  it("is pending, slows a poll faster than the interval, then grants once", async () => {
    const { fake, advance, poll } = await polled();
    expect(await poll()).toBe(400);
    expect(await poll()).toBe(429);
    fake.approve();
    advance(6000);
    expect(await poll()).toBe(200);
    advance(6000);
    expect(await poll()).toBe(409);
  });

  it("does not know a code it never issued, refuses a denied one, and expires one after 600 s", async () => {
    const { fake, advance, poll } = await polled();
    expect(await poll("never-issued")).toBe(404);
    fake.deny();
    expect(await poll()).toBe(418);
    advance(600_000);
    expect(await poll()).toBe(410);
  });

  it("keeps an earlier code valid for its own 600 s after a newer one is issued", async () => {
    const { advance, poll, send } = await polled();
    advance(300_000);
    const newer = (await (await send("POST", "/oauth/device/code", {})).json()) as {
      device_code: string;
    };
    expect(await poll()).toBe(400);
    advance(300_000);
    expect(await poll()).toBe(410);
    expect(await poll(newer.device_code)).toBe(400);
  });
});

describe("rate limits (https://developer.trakt.tv/docs/rate-limiting)", () => {
  it("allows one authed POST a second, naming the bucket and when to retry", async () => {
    const { send, advance } = fakeAt();
    expect((await send("POST", "/sync/history", mark)).status).toBe(201);
    advance(400);
    const limited = await send("POST", "/sync/history/remove", mark);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(JSON.parse(limited.headers.get("x-ratelimit") ?? "{}")).toMatchObject({
      name: "AUTHED_API_POST_LIMIT",
      remaining: 0,
    });
    advance(600);
    expect((await send("POST", "/sync/history/remove", mark)).status).toBe(200);
  });

  it("allows 500 GETs in a 5-minute window, then pauses until the window ends", async () => {
    const { send, advance } = fakeAt();
    for (let read = 0; read < 500; read += 1) await send("GET", "/sync/last_activities");
    advance(MINUTE);
    const limited = await send("GET", "/sync/last_activities");
    expect([limited.status, limited.headers.get("retry-after")]).toEqual([429, "240"]);
    expect(JSON.parse(limited.headers.get("x-ratelimit") ?? "{}")).toMatchObject({
      name: "AUTHED_API_GET_LIMIT",
      period: 300,
      limit: 500,
    });
    advance(4 * MINUTE);
    expect((await send("GET", "/sync/last_activities")).status).toBe(200);
  });
});
