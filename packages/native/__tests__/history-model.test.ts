import { groupHistory } from "@cue/core/domain/history";
import { entryDetail, historySections } from "../src/screens/history/model";
import { historyEntry } from "./support/history";

test("local days retain separate rewatches and insert year boundaries", () => {
  const newest = historyEntry({ watchedAt: "2026-01-01T20:00:00Z" });
  const older = historyEntry({ historyId: 2, watchedAt: "2026-01-01T02:00:00Z" });
  const days = groupHistory([older, newest], {
    now: Date.parse(newest.watchedAt),
    timeZone: "America/Los_Angeles",
  });
  const sections = historySections(days, "");
  expect(sections.map((section) => section.key)).toEqual(["2026-01-01", "2025-12-31"]);
  expect(sections.map((section) => section.yearHeading)).toEqual([null, "2025"]);
  expect(sections.flatMap((section) => section.data).map((row) => row.plays)).toEqual([1, 1]);
});

test("different episodes stay separate and mixed day totals count plays", () => {
  const episode = {
    ...historyEntry({ episodeTitle: "Night Signal" }),
    type: "episode" as const,
    season: 1,
    number: 2,
  };
  const days = groupHistory(
    [
      episode,
      { ...episode, historyId: 4 },
      { ...episode, number: 3, historyId: 5 },
      historyEntry(),
    ],
    { now: Date.now(), timeZone: "UTC" },
  );
  const section = historySections(days, "")[0];
  expect(section?.data.map((row) => row.plays)).toEqual([2, 1, 1]);
  expect(section?.label).toMatch(/3 episodes · 1 movie$/);
  expect(entryDetail(episode)).toBe("S1 E2 Night Signal");
  expect(entryDetail({ ...episode, episodeTitle: null })).toBe("S1 E2");
  expect(entryDetail(historyEntry({ year: null }))).toBe("Movie");
});
