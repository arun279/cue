import { queryKeys } from "@cue/core/data/query-keys";
import { episodePlaysQuery, showRelatedQuery } from "@cue/core/queries/shows";
import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { buildRuntime } from "./_runtime";

it("shares related reads and invalidates plays with their episode", async () => {
  const runtime = await buildRuntime();
  const related = vi.spyOn(runtime, "loadShowRelated").mockResolvedValue([]);
  const plays = vi.spyOn(runtime, "loadEpisodePlays").mockResolvedValue([]);
  const client = new QueryClient();
  await client.fetchQuery(showRelatedQuery(runtime, 8803));
  await client.fetchQuery(showRelatedQuery(runtime, 8803));
  expect(related).toHaveBeenCalledExactlyOnceWith(8803);
  const episode = episodePlaysQuery(runtime, 8803, 2, 3, 880308);
  await client.fetchQuery(episode);
  expect(plays).toHaveBeenCalledExactlyOnceWith(880308);
  await client.invalidateQueries({ queryKey: queryKeys.episode(8803, 2, 3) });
  expect(client.getQueryState(episode.queryKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.showRelated(8803))?.isInvalidated).toBe(false);
  client.clear();
});
