import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime } from "./_runtime";

const server = mswServer();

function historyOf(watchedAt: readonly string[], requested: URL[]) {
  return http.get(`${TRAKT_API_BASE}/users/me/history`, ({ request }) => {
    const url = new URL(request.url);
    requested.push(url);
    const limit = Number(url.searchParams.get("limit"));
    const page = Number(url.searchParams.get("page"));
    const rows = watchedAt
      .slice((page - 1) * limit, page * limit)
      .map((at, index) => ({ id: page * 100 + index, watched_at: at, type: "movie" }));
    return HttpResponse.json(rows, {
      headers: {
        "X-Pagination-Page": String(page),
        "X-Pagination-Page-Count": String(Math.max(1, Math.ceil(watchedAt.length / limit))),
      },
    });
  });
}

it("reads the oldest play from the last one-play page, in two reads", async () => {
  const requested: URL[] = [];
  server.use(
    historyOf(
      ["2026-10-01T10:00:00.000Z", "2025-04-02T10:00:00.000Z", "2019-03-09T10:00:00.000Z"],
      requested,
    ),
  );

  expect(await (await buildRuntime()).loadFirstPlayAt()).toBe("2019-03-09T10:00:00.000Z");
  expect(
    requested.map((url) => [url.searchParams.get("page"), url.searchParams.get("limit")]),
  ).toEqual([
    ["1", "1"],
    ["3", "1"],
  ]);
});

it("answers null for an account with no plays, in one read", async () => {
  const requested: URL[] = [];
  server.use(historyOf([], requested));

  expect(await (await buildRuntime()).loadFirstPlayAt()).toBeNull();
  expect(requested).toHaveLength(1);
});
