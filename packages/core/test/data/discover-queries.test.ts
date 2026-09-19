import type { SearchHit } from "@cue/core/data/trakt/search";
import { browseQuery, searchQuery } from "@cue/core/queries/discover";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { buildRuntime } from "./_runtime";

const hits = [
  {
    key: "show:8801",
    type: "show",
    traktId: 8801,
    title: "Harbor Lights",
    year: 2021,
    posters: ["https://images.test/harbor.jpg"],
    tmdbId: 9001,
    ids: { trakt: 8801, slug: "harbor-lights", tmdb: 9001 },
  },
] satisfies readonly SearchHit[];

afterEach(() => vi.useRealTimers());

it("requests both media types and returns the runtime's search response", async () => {
  const runtime = await buildRuntime();
  const search = vi.spyOn(runtime, "search").mockResolvedValue(hits);
  const client = new QueryClient();
  const query = searchQuery(runtime, "harbor");

  expect(query.queryKey).toEqual(["search", "show,movie", "harbor"]);
  await expect(client.fetchQuery(query)).resolves.toBe(hits);
  expect(search).toHaveBeenCalledExactlyOnceWith("harbor");
  client.clear();
});

it("keeps the mapped browse response fresh for five minutes", async () => {
  vi.useFakeTimers();
  const runtime = await buildRuntime();
  const browse = {
    trending: hits,
    popular: [],
    trendingMovies: [],
    popularMovies: [],
  };
  const loadBrowse = vi.spyOn(runtime, "loadBrowse").mockResolvedValue(browse);
  const client = new QueryClient();
  const query = browseQuery(runtime);

  await expect(client.fetchQuery(query)).resolves.toBe(browse);
  vi.advanceTimersByTime(5 * 60 * 1000 - 1);
  await expect(client.fetchQuery(query)).resolves.toBe(browse);
  expect(loadBrowse).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(1);
  await expect(client.fetchQuery(query)).resolves.toBe(browse);
  expect(loadBrowse).toHaveBeenCalledTimes(2);
  client.clear();
});
