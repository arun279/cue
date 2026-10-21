import { TRAKT_API_BASE } from "@cue/core/data/auth/oauth";
import { genreNamesQuery } from "@cue/core/queries/genres";
import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime } from "./_runtime";

const server = mswServer();

it("reads both genre lists once and keeps the names for the rest of the session", async () => {
  const paths: string[] = [];
  server.use(
    http.get(`${TRAKT_API_BASE}/genres/:type`, ({ request, params }) => {
      paths.push(new URL(request.url).pathname);
      return HttpResponse.json(
        params["type"] === "shows"
          ? [{ name: "Science Fiction", slug: "science-fiction" }]
          : [{ name: "Superhero", slug: "superhero" }],
      );
    }),
  );
  const runtime = await buildRuntime();
  const client = new QueryClient();

  await expect(client.fetchQuery(genreNamesQuery(runtime))).resolves.toEqual({
    "science-fiction": "Science Fiction",
    superhero: "Superhero",
  });
  await client.fetchQuery(genreNamesQuery(runtime));
  await client.fetchQuery(genreNamesQuery(runtime));

  expect(paths.toSorted()).toEqual(["/genres/movies", "/genres/shows"]);
  client.clear();
});
