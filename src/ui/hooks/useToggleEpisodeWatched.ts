import { queryKeys } from "@data/query-keys";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { ShowHeader } from "@data/trakt/show-detail";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

export interface ToggleEpisodeWatched {
  toggle(episode: EpisodeDetail): Promise<void>;
  clearError(): void;
  readonly error: string | null;
}

/**
 * The Episode-detail watched toggle. Marking ON enqueues a durable
 * `POST /sync/history`; marking OFF enqueues `POST /sync/history/remove
 * {episodes:[{ids}]}` — the all-plays MVP unwatch (no history-id). The toggle is
 * optimistic (the detail flips instantly, with the watched date) and rolls back
 * on a hard failure; the reconcile anchor is the show's pre-op `completed`, so a
 * lost response is retired by a progress re-read, never a duplicate play.
 */
export function useToggleEpisodeWatched(): ToggleEpisodeWatched {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (episode: EpisodeDetail) => {
      const key = queryKeys.episode(episode.showId, episode.season, episode.number);
      // Cancel in-flight reads so a settling refetch can't overwrite the flip.
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<EpisodeDetail>(key);
      const next = !episode.watched;
      // Mark uses a fresh timestamp; unmark freezes the play's *original* watched
      // date onto the restore-inverse so Undo of an unwatch re-adds the exact play.
      const freshWatchedAt = new Date().toISOString();
      const watchedAt = next ? freshWatchedAt : (episode.watchedAt ?? freshWatchedAt);

      queryClient.setQueryData<EpisodeDetail>(key, (old) =>
        old === undefined
          ? old
          : { ...old, watched: next, watchedAt: next ? freshWatchedAt : null },
      );

      const header = queryClient.getQueryData<ShowHeader>(queryKeys.showHeader(episode.showId));
      const params = {
        opId: crypto.randomUUID(),
        ids: episode.ids,
        watchedAt,
        inversePatch: { showId: episode.showId, preCompleted: header?.completed ?? 0 },
      };
      const op = next ? buildMarkEpisodeOp(params) : buildUnmarkEpisodeOp(params);

      const outcome = await runtime.submit(op);
      if (outcome === "failed") {
        if (before !== undefined) queryClient.setQueryData(key, before);
        setError("Couldn't update this episode. Please try again.");
        return;
      }
      // Revalidate only once the write landed on Trakt; a still-queued op would
      // refetch pre-write progress over the optimistic state.
      if (outcome === "done") {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queryKeys.showSeasons(episode.showId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.showHeader(episode.showId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      }
    },
    [queryClient, runtime],
  );

  return { toggle, clearError: () => setError(null), error };
}
