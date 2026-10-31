import { afterEach, expect, it, vi } from "vitest";
import { TraktClient } from "@/core/data/trakt/client";
import { getShow } from "@/core/data/trakt/pooled-endpoints";
import { resetReadPause } from "@/core/data/trakt/read-budget";
import { createTraktFake } from "../trakt-fake/fake.ts";

const fake = createTraktFake();

afterEach(() => {
  fake.reset();
  resetReadPause();
});

const client = (): TraktClient =>
  new TraktClient({
    clientId: "client",
    getToken: () => fake.session().access_token,
    fetch: fake.fetch,
  });

const showReads = () => fake.requests.filter((r) => /^\/shows\/\d+$/.test(r.path));

it("shares a read only between callers asking for the same thing", async () => {
  const release = fake.hold({ path: /^\/shows\/\d+$/, times: Number.POSITIVE_INFINITY });
  const trakt = client();
  const reads = Promise.all([getShow(trakt, 8806), getShow(trakt, 8802), getShow(trakt, 8806)]);
  await vi.waitFor(() => expect(showReads()).toHaveLength(2));
  release();
  const [first, other, again] = await reads;

  expect(showReads().map((r) => r.path)).toEqual(["/shows/8806", "/shows/8802"]);
  expect(again).toBe(first);
  expect(other).not.toBe(first);
});

it("hands a shared read's failure to every caller, and reads afresh after it", async () => {
  fake.fail({ path: /^\/shows\/8806$/ }, 503);
  const trakt = client();
  const failed = await Promise.all([getShow(trakt, 8806), getShow(trakt, 8806)]);

  expect(failed).toEqual([
    { ok: false, error: { kind: "server", status: 503 } },
    { ok: false, error: { kind: "server", status: 503 } },
  ]);
  expect(showReads()).toHaveLength(1);
  expect((await getShow(trakt, 8806)).ok).toBe(true);
  expect(showReads()).toHaveLength(2);
});
