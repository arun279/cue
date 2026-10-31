import { expect, it } from "vitest";
import { requestDeviceCode } from "@/core/data/auth/oauth";
import { TraktClient } from "@/core/data/trakt/client";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const fake = startTraktFake();

const credentialsSent = () => fake.requests.map((request) => request.credentials);

it("sends the runtime's Trakt reads without cookies", async () => {
  const runtime = await buildRuntime();

  await runtime.loadShowRelated(8803);

  expect(credentialsSent().length).toBeGreaterThan(0);
  expect(new Set(credentialsSent())).toEqual(new Set(["omit"]));
});

it("sends sign-in requests, and a client's reads, without cookies when nothing else is given", async () => {
  await requestDeviceCode({ clientId: "cid", redirectUri: "cue://auth" }, "challenge");
  await new TraktClient({ clientId: "cid" }).get("/users/settings");

  expect(credentialsSent()).toEqual(["omit", "omit"]);
});
