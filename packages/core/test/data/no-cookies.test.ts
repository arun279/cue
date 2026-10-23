import { requestDeviceCode } from "@cue/core/data/auth/oauth";
import { TRAKT_API_BASE, TraktClient } from "@cue/core/data/trakt/client";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime } from "./_runtime";

const server = mswServer();

/** Answers every Trakt request with an empty body, keeping the credentials mode each was sent with. */
function credentialsSent(): RequestCredentials[] {
  const modes: RequestCredentials[] = [];
  server.use(
    http.all(`${TRAKT_API_BASE}/*`, ({ request }) => {
      modes.push(request.credentials);
      return HttpResponse.json(request.url.includes("/oauth/device/code") ? DEVICE_CODE : []);
    }),
  );
  return modes;
}

const DEVICE_CODE = {
  device_code: "dev-1",
  user_code: "ABCD1234",
  verification_url: "https://trakt.tv/activate",
  expires_in: 600,
  interval: 5,
};

it("sends the runtime's Trakt reads without cookies", async () => {
  const modes = credentialsSent();
  const runtime = await buildRuntime();

  await runtime.loadShowRelated(8803);

  expect(modes.length).toBeGreaterThan(0);
  expect(new Set(modes)).toEqual(new Set(["omit"]));
});

it("sends sign-in requests, and a client's reads, without cookies when nothing else is given", async () => {
  const modes = credentialsSent();

  await requestDeviceCode({ clientId: "cid", redirectUri: "cue://auth" }, "challenge");
  await new TraktClient({ clientId: "cid" }).get("/users/settings");

  expect(modes).toEqual(["omit", "omit"]);
});
