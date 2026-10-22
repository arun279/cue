import { describe, expect, it } from "vitest";
import { FIXTURE_NOW } from "../../../../scripts/mock-trakt/seed.mjs";
import { mockTraktBase } from "./mock-server";
import { runScenarios, type Wire } from "./scenarios";
import recorded from "./trakt-transcripts.json";

const baseUrl = mockTraktBase();

const wire: Wire = async (method, path, body) => {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { authorization: "Bearer mock-access-token", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    body: text === "" ? null : JSON.parse(text),
  };
};

describe("the mock behaves the way real Trakt was recorded behaving", () => {
  it.each([
    ["multiple-plays-off", false],
    ["multiple-plays-on", true],
  ] as const)("on an account with %s", async (setting, keepsEveryPlay) => {
    await fetch(`${baseUrl()}/__reset?seed=${keepsEveryPlay ? "default" : setting}`, {
      method: "POST",
    });
    expect(await runScenarios(wire, FIXTURE_NOW, keepsEveryPlay)).toEqual(recorded[setting]);
  });
});
