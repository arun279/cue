// @vitest-environment jsdom
import { useGenreLabels } from "@cue/core/hooks/useGenreLabels";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { partialRuntime, withRuntime } from "../support/runtime";

async function mountLabels(
  slugs: readonly string[],
  loadGenreNames: () => Promise<Record<string, string>>,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runtime = partialRuntime({ loadGenreNames });
  const { result } = renderHook(() => useGenreLabels(slugs), {
    wrapper: withRuntime(runtime, client),
  });
  await act(async () => {});
  return result;
}

it("draws the title-cased slug until Trakt's names arrive, then Trakt's name, and keeps the fallback for a slug Trakt does not list", async () => {
  let release: (names: Record<string, string>) => void = () => {};
  const loadGenreNames = vi.fn(
    () =>
      new Promise<Record<string, string>>((resolve) => {
        release = resolve;
      }),
  );
  const labels = await mountLabels(["science-fiction", "home-and-garden"], loadGenreNames);
  expect(labels.current).toEqual(["Science Fiction", "Home And Garden"]);

  await act(async () => release({ "science-fiction": "Sci-Fi" }));

  await vi.waitFor(() => expect(labels.current).toEqual(["Sci-Fi", "Home And Garden"]));
  expect(loadGenreNames).toHaveBeenCalledOnce();
});

it("asks Trakt for nothing when a title has no genres", async () => {
  const loadGenreNames = vi.fn(async () => ({}));
  const labels = await mountLabels([], loadGenreNames);

  expect(labels.current).toEqual([]);
  expect(loadGenreNames).not.toHaveBeenCalled();
});
