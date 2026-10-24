import { TraktClient } from "@cue/core/data/trakt/client";
import { createTraktTransport } from "@cue/core/data/trakt/transport";
import { buildMarkEpisodeOp } from "@cue/core/domain/write-queue/ops";
import { WriteQueue } from "@cue/core/domain/write-queue/queue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTraktFake } from "../trakt-fake/fake.ts";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";
const HISTORY = { method: "POST", path: /^\/sync\/history$/ } as const;

/** One clock for the queue's sleeps and the fake's rate limiter, so waiting is instant and real to both. */
let now = 0;
const fake = createTraktFake({ clock: () => now });
const client = new TraktClient({
  clientId: "cid",
  getToken: () => fake.session().access_token,
  fetch: fake.fetch,
});

beforeEach(() => {
  now = Date.parse("2026-10-15T00:00:00.000Z");
  fake.reset();
});

const mark = (opId: string, trakt: number) =>
  buildMarkEpisodeOp({ opId, ids: { trakt }, watchedAt: WATCHED_AT });

function queueWith(ops = [mark("op-1", 880120)], reconcile = () => Promise.resolve(false)) {
  return new WriteQueue(
    {
      dispatch: createTraktTransport(client),
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
      now: () => now,
      reconcile,
      settle: () => true,
    },
    ops,
  );
}

const posts = () => fake.requests.filter((request) => request.path === "/sync/history");

describe("Trakt transport wires the write queue to the client", () => {
  it("dispatches a queued mark as a POST /sync/history with the frozen body + auth header", async () => {
    const result = await queueWith().flush();
    expect(result.completed.map((op) => op.id)).toEqual(["op-1"]);
    const [sent] = posts();
    expect(sent?.headers["authorization"]).toBe(`Bearer ${fake.session().access_token}`);
    expect(sent?.body).toEqual({ episodes: [{ ids: { trakt: 880120 }, watched_at: WATCHED_AT }] });
  });

  it("paces queued writes under Trakt's one POST a second, so none is rate limited", async () => {
    const result = await queueWith([mark("op-1", 880120), mark("op-2", 880121)]).flush();
    expect(result.completed).toHaveLength(2);
    expect(posts().map((request) => request.status)).toEqual([201, 201]);
  });

  it("classifies a 429 as retryable via the transport and honors Retry-After", async () => {
    fake.fail(HISTORY, 429, 2);
    const result = await queueWith().flush();
    expect(result.completed).toHaveLength(1);
    expect(posts().map((request) => request.status)).toEqual([429, 201]);
  });

  it("reconciles a network reject instead of blind-retrying", async () => {
    fake.drop(HISTORY);
    const reconcile = vi.fn(() => Promise.resolve(true));
    const result = await queueWith(undefined, reconcile).flush();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result.completed).toHaveLength(1);
  });
});
