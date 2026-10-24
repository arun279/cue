import { selectVisibleEntries } from "@cue/core/domain/calendar";
import { expect, it } from "vitest";
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

it("leaves a dropped show off the calendar, which Trakt keeps listing it on", async () => {
  await call("POST", "/users/hidden/dropped", { shows: [{ ids: { trakt: AIRING } }] });
  const listed = (await (await call("GET", `/calendars/my/shows/${WINDOW.join("/")}`)).json()) as {
    show: { ids: { trakt: number } };
  }[];
  const runtime = await buildRuntime();

  const visible = selectVisibleEntries(await runtime.loadCalendar(...WINDOW));

  expect(listed.map((row) => row.show.ids.trakt)).toContain(AIRING);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.map((entry) => entry.showId)).not.toContain(AIRING);
});
