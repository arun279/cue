import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import { createTraktTransport } from "@data/trakt/transport";
import { buildMarkEpisodeOp } from "@domain/write-queue/ops";
import { WriteQueue } from "@domain/write-queue/queue";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();
const WATCHED_AT = "2026-07-05T12:00:00.000Z";

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  const sleep = (ms: number): Promise<void> => {
    t += ms;
    return Promise.resolve();
  };
  return { now: () => t, sleep };
}

function queueWith(client: TraktClient, reconcile = () => Promise.resolve(false)): WriteQueue {
  const clock = fakeClock();
  const op = buildMarkEpisodeOp({ opId: "op-1", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
  return new WriteQueue(
    { dispatch: createTraktTransport(client), sleep: clock.sleep, now: clock.now, reconcile },
    [op],
  );
}

describe("Trakt transport wires the write queue to the client", () => {
  const client = new TraktClient({ clientId: "cid", getToken: () => "tok" });

  it("dispatches a queued mark as a POST /sync/history with the frozen body + auth header", async () => {
    let body: unknown;
    let auth: string | null = null;
    server.use(
      http.post(`${TRAKT_API_BASE}/sync/history`, async ({ request }) => {
        auth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json({ added: { episodes: 1 } });
      }),
    );
    const result = await queueWith(client).flush();
    expect(result.completed.map((op) => op.id)).toEqual(["op-1"]);
    expect(auth).toBe("Bearer tok");
    expect(body).toEqual({ episodes: [{ ids: { trakt: 42 }, watched_at: WATCHED_AT }] });
  });

  it("classifies a 429 as retryable via the transport and honors Retry-After", async () => {
    let calls = 0;
    server.use(
      http.post(`${TRAKT_API_BASE}/sync/history`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { "Retry-After": "2" } })
          : HttpResponse.json({ added: { episodes: 1 } });
      }),
    );
    const result = await queueWith(client).flush();
    expect(result.completed).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("reconciles a network reject instead of blind-retrying", async () => {
    server.use(http.post(`${TRAKT_API_BASE}/sync/history`, () => HttpResponse.error()));
    const reconcile = vi.fn(() => Promise.resolve(true));
    const result = await queueWith(client, reconcile).flush();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result.completed).toHaveLength(1);
  });
});
