import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import { selectVisibleEntries } from "@cue/core/domain/calendar";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime } from "./_runtime";

const server = mswServer();
const onePage = { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "1" };
const show = (trakt: number) => ({ title: `Show ${trakt}`, ids: { trakt } });

it("leaves a dropped show off the calendar, which Trakt keeps listing it on", async () => {
  server.use(
    http.get(`${TRAKT_API_BASE}/calendars/my/shows/:start/:days`, () =>
      HttpResponse.json(
        [7, 8].map((trakt) => ({
          first_aired: "2026-07-14T01:00:00.000Z",
          episode: { season: 1, number: 2, title: "Episode", ids: { trakt: trakt * 10 } },
          show: show(trakt),
        })),
      ),
    ),
    http.get(`${TRAKT_API_BASE}/users/hidden/progress_watched`, () =>
      HttpResponse.json([], { headers: onePage }),
    ),
    http.get(`${TRAKT_API_BASE}/users/hidden/dropped`, () =>
      HttpResponse.json([{ hidden_at: "2026-07-01T00:00:00.000Z", type: "show", show: show(7) }], {
        headers: onePage,
      }),
    ),
  );
  const runtime = await buildRuntime();

  const visible = selectVisibleEntries(await runtime.loadCalendar("2026-07-12", 7));

  expect(visible.map((entry) => entry.showId)).toEqual([8]);
});
