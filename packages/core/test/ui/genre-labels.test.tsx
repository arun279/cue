// @vitest-environment jsdom
import type { GenreNames } from "@cue/core/domain/genres";
import { useGenreLabels } from "@cue/core/hooks/useGenreLabels";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

function Probe({
  slugs,
  onLabels,
}: {
  readonly slugs: readonly string[];
  onLabels(labels: readonly string[]): void;
}): null {
  onLabels(useGenreLabels(slugs));
  return null;
}

async function mountLabels(slugs: readonly string[], loadGenreNames: () => Promise<GenreNames>) {
  const seen: (readonly string[])[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runtime = { loadGenreNames } as unknown as CueRuntime;
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe slugs={slugs} onLabels={(labels) => seen.push(labels)} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return seen;
}

it("draws the title-cased slug until Trakt's names arrive, then Trakt's name", async () => {
  let release: (names: GenreNames) => void = () => {};
  const loadGenreNames = vi.fn(
    () =>
      new Promise<GenreNames>((resolve) => {
        release = resolve;
      }),
  );
  const seen = await mountLabels(["science-fiction"], loadGenreNames);
  expect(seen.at(-1)).toEqual(["Science Fiction"]);

  await act(async () => release({ "science-fiction": "Sci-Fi" }));

  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["Sci-Fi"]));
  expect(loadGenreNames).toHaveBeenCalledOnce();
});

it("asks Trakt for nothing when a title has no genres", async () => {
  const loadGenreNames = vi.fn(async () => ({}));
  const seen = await mountLabels([], loadGenreNames);

  expect(seen.at(-1)).toEqual([]);
  expect(loadGenreNames).not.toHaveBeenCalled();
});
