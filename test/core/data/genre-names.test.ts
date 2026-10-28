import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { genreNamesQuery } from "@/core/queries/genres";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const fake = startTraktFake();

it("reads both genre lists once and keeps the names for the rest of the session", async () => {
  const runtime = await buildRuntime();
  const client = new QueryClient();

  await expect(client.fetchQuery(genreNamesQuery(runtime))).resolves.toMatchObject({
    "science-fiction": "Science Fiction",
    superhero: "Superhero",
    "game-show": "Game Show",
  });
  await client.fetchQuery(genreNamesQuery(runtime));
  await client.fetchQuery(genreNamesQuery(runtime));

  const paths = fake.requests.map(({ path }) => path).filter((path) => path.startsWith("/genres/"));
  expect(paths.toSorted()).toEqual(["/genres/movies", "/genres/shows"]);
  client.clear();
});
