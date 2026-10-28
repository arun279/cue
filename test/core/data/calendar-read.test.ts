import { expect, it } from "vitest";
import { hiddenShowIdsOf, selectVisibleEntries } from "@/core/domain/calendar";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const fake = startTraktFake();

/** Nine Lives of Ada Rook airs its tenth episode on 2026-10-20, inside this window. */
const AIRING = 8806;
const WINDOW = ["2026-10-15", 7] as const;

const call = (method: string, path: string, body?: unknown) =>
  fake.fetch(`https://api.trakt.tv${path}`, {
    method,
    headers: { authorization: `Bearer ${fake.session().access_token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

it("leaves a show dropped in the library off the calendar, which Trakt keeps listing it on", async () => {
  await call("POST", "/users/hidden/dropped", { shows: [{ ids: { trakt: AIRING } }] });
  const listed = (await (await call("GET", `/calendars/my/shows/${WINDOW.join("/")}`)).json()) as {
    show: { ids: { trakt: number } };
  }[];
  const runtime = await buildRuntime();

  const [{ entries }, library] = await Promise.all([
    runtime.loadCalendar(...WINDOW),
    runtime.loadUpNext(),
  ]);
  const visible = selectVisibleEntries({
    entries,
    hiddenShowIds: hiddenShowIdsOf(library.entries),
  });

  expect(listed.map((row) => row.show.ids.trakt)).toContain(AIRING);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.map((entry) => entry.showId)).not.toContain(AIRING);
});

it("carries Trakt's episode type, so a season dropped at once opens on its premiere", async () => {
  const runtime = await buildRuntime();
  const { entries } = await runtime.loadCalendar(...WINDOW);
  const drop = entries.filter((entry) => entry.showId === 8802);
  expect(drop.map((entry) => entry.episodeType)).toEqual([
    "season_premiere",
    ...Array.from({ length: 6 }, () => "standard"),
    "season_finale",
  ]);
});
