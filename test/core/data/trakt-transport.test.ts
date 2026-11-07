import { beforeEach, describe, expect, it } from "vitest";
import { TraktClient } from "@/core/data/trakt/client";
import { createTraktTransport } from "@/core/data/trakt/transport";
import { buildMarkEpisodeOp } from "@/core/domain/write-queue/ops";
import { WriteQueue } from "@/core/domain/write-queue/queue";
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

function queueWith(ops = [mark("op-1", 880120)]) {
  return new WriteQueue(
    {
      dispatch: createTraktTransport(client),
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
      now: () => now,
      settle: () => "applied",
      ownPlays: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    },
    ops,
  );
}

const posts = () => fake.requests.filter((request) => request.path === "/sync/history");

describe("Trakt transport wires the write queue to the client", () => {
  it("dispatches a queued mark as a POST /sync/history with the frozen body + auth header", async () => {
    const queue = queueWith();
    await queue.flush();
    expect(queue.stateOf("op-1")).toBe("done");
    const [sent] = posts();
    expect(sent?.headers["authorization"]).toBe(`Bearer ${fake.session().access_token}`);
    expect(sent?.body).toEqual({ episodes: [{ ids: { trakt: 880120 }, watched_at: WATCHED_AT }] });
  });

  it("paces queued writes under Trakt's one POST a second, so none is rate limited", async () => {
    await queueWith([mark("op-1", 880120), mark("op-2", 880121)]).flush();
    expect(posts().map((request) => request.status)).toEqual([201, 201]);
  });

  it("classifies a 429 as retryable via the transport and honors Retry-After", async () => {
    fake.fail(HISTORY, 429, 2);
    const queue = queueWith();
    await queue.flush();
    expect(queue.stateOf("op-1")).toBe("done");
    expect(posts().map((request) => request.status)).toEqual([429, 201]);
  });

  it("sends the same body again on the next flush when the connection drops", async () => {
    fake.drop(HISTORY);
    const queue = queueWith();
    await queue.flush();
    expect(queue.stateOf("op-1")).toBe("sent");
    await queue.flush();
    expect(queue.stateOf("op-1")).toBe("done");
    const [dropped, sent] = posts();
    expect(sent?.body).toEqual(dropped?.body);
  });
});
