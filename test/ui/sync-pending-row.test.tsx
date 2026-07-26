import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import type { Progress } from "@data/trakt/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type CueRuntime, RuntimeProvider, type UpNextData } from "@ui/runtime/runtime";
import { SyncPendingRow } from "@ui/screens/up-next/SyncPendingRow";
import { act, type ReactNode, useState } from "react";
import { expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
    readonly "aria-label"?: string;
  }) => (
    <a href="/show/77" className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

const entry: LibraryEntry = {
  showId: 77,
  title: "Budget Tail",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-06-01T00:00:00.000Z",
  aired: 1,
  completed: 1,
  nextEpisode: null,
  progressKnown: false,
  posters: [],
  backdrops: [],
  network: null,
  genres: [],
  runtime: null,
  tmdbId: null,
  pendingAdvance: false,
};

const progress: Progress = {
  aired: 2,
  completed: 1,
  last_watched_at: "2026-07-01T00:00:00.000Z",
  next_episode: {
    season: 1,
    number: 2,
    title: "Two",
    first_aired: "2026-06-15T00:00:00.000Z",
    ids: { trakt: 772 },
    images: { screenshot: ["media.trakt.tv/two.jpg"] },
  },
  seasons: [],
};

function runtimeWith(loadShowProgress: CueRuntime["loadShowProgress"]): CueRuntime {
  return {
    loadShowProgress,
    loadShowArt: () =>
      Promise.resolve({ posters: [], backdrops: [], network: null, genres: [], runtime: null }),
  } as unknown as CueRuntime;
}

function clientWithEntry(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<UpNextData>(queryKeys.library(), {
    entries: [entry],
    isPartial: true,
  });
  return client;
}

async function flushQueries(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("reads visible progress once and promotes the library entry", async () => {
  let resolveRead: (value: Progress) => void = () => undefined;
  const pendingRead = new Promise<Progress>((resolve) => {
    resolveRead = resolve;
  });
  const loadShowProgress = vi.fn<CueRuntime["loadShowProgress"]>(() => pendingRead);
  const client = clientWithEntry();
  let show = (): void => undefined;

  function Harness(): ReactNode {
    const [visible, setVisible] = useState(false);
    show = () => setVisible(true);
    return <SyncPendingRow entry={entry} visible={visible} />;
  }

  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtimeWith(loadShowProgress)}>
        <Harness />
      </RuntimeProvider>
    </QueryClientProvider>,
  );

  expect(loadShowProgress).not.toHaveBeenCalled();
  await act(async () => show());
  expect(loadShowProgress).toHaveBeenCalledTimes(1);
  expect(loadShowProgress).toHaveBeenCalledWith(entry.showId, expect.any(AbortSignal));
  expect(document.querySelector('[data-testid="sync-pending-row"]')).toHaveTextContent(
    "Syncing progress…",
  );
  expect(document.querySelector('[data-striped="true"]')).not.toBeNull();

  await act(async () => resolveRead(progress));
  await flushQueries();

  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries[0]).toMatchObject({
    aired: 2,
    completed: 1,
    lastWatchedAt: "2026-07-01T00:00:00.000Z",
    progressKnown: true,
    pendingAdvance: false,
    nextEpisode: {
      season: 1,
      number: 2,
      title: "Two",
      still: "https://media.trakt.tv/two.jpg",
      ids: { trakt: 772 },
    },
  });
  await flushQueries();
  expect(loadShowProgress).toHaveBeenCalledTimes(1);
});

it("replaces the shimmer with a retry after a progress error", async () => {
  const loadShowProgress = vi
    .fn<CueRuntime["loadShowProgress"]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(progress);
  const client = clientWithEntry();

  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtimeWith(loadShowProgress)}>
        <SyncPendingRow entry={entry} visible />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  await flushQueries();

  expect(document.querySelector('[data-testid="sync-pending-row"]')).toHaveTextContent(
    "Couldn't load progress.",
  );
  expect(document.querySelector('[data-striped="true"]')).toBeNull();
  const retry = document.querySelector<HTMLButtonElement>('[data-testid="sync-pending-retry"]');
  expect(retry).not.toBeNull();

  await act(async () => retry?.click());
  await flushQueries();

  expect(loadShowProgress).toHaveBeenCalledTimes(2);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries[0]).toMatchObject({
    progressKnown: true,
    nextEpisode: { season: 1, number: 2 },
  });
});
