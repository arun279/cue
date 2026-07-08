import { showProgressKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { ShowHeader } from "@data/trakt/show-detail";
import { buildMarkEpisodeOp, buildRemovePlaysOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";
import { resolveEpisodeUnmark } from "./resolveUnmark";
import { useResumeOnMark } from "./useResumeOnMark";

export interface ToggleEpisodeWatched {
  toggle(episode: EpisodeDetail): Promise<void>;
  clearError(): void;
  /** A non-error advisory: the uncheck was refused because the episode has more
   * than one play (a rewatch) and per-play removal lives in the Diary. */
  readonly notice: string | null;
  dismissNotice(): void;
  readonly error: string | null;
}

/**
 * The Episode-detail watched toggle. Marking ON enqueues
 * a durable `POST /sync/history`. Marking OFF is a DURABLE, per-play-safe unmark:
 * it resolves the episode's real Trakt plays and removes the single play by its
 * exact history id — never an item-scoped `remove {episodes:[{ids}]}` that would
 * wipe a rewatch. If the episode carries two or more plays, the uncheck is refused
 * and the user is pointed at the Diary (where each play is individually removable),
 * so a rewatch can never be destroyed here. The toggle is optimistic (the detail
 * flips instantly) and rolls back on a refusal or hard failure.
 */
export function useToggleEpisodeWatched(): ToggleEpisodeWatched {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const resume = useResumeOnMark();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const revalidate = useCallback(
    (episode: EpisodeDetail) => {
      for (const queryKey of showProgressKeys(episode.showId, {
        season: episode.season,
        number: episode.number,
      })) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient],
  );

  const markOn = useCallback(
    async (episode: EpisodeDetail, key: readonly unknown[], before: EpisodeDetail | undefined) => {
      const watchedAt = new Date().toISOString();
      queryClient.setQueryData<EpisodeDetail>(key, (old) =>
        old === undefined ? old : { ...old, watched: true, watchedAt },
      );
      const header = queryClient.getQueryData<ShowHeader>(queryKeys.showHeader(episode.showId));
      const op = buildMarkEpisodeOp({
        opId: crypto.randomUUID(),
        ids: episode.ids,
        watchedAt,
        inversePatch: { showId: episode.showId, preCompleted: header?.completed ?? 0 },
      });
      const outcome = await submit([op], {
        rollback: () => {
          if (before !== undefined) queryClient.setQueryData(key, before);
        },
        // A watch on a Stopped show un-stops it: the unhide
        // must land before revalidate so the library re-read doesn't refile it.
        onKept:
          header !== undefined
            ? () => resume.resumeIfStopped(episode.showId, header.ids)
            : undefined,
        revalidate: () => revalidate(episode),
      });
      if (outcome === "failed") setError("Couldn't update this episode. Please try again.");
    },
    [queryClient, submit, resume, revalidate],
  );

  const markOff = useCallback(
    async (episode: EpisodeDetail, key: readonly unknown[], before: EpisodeDetail | undefined) => {
      // Optimistic un-tick first; the durable removal (or its refusal) settles behind.
      queryClient.setQueryData<EpisodeDetail>(key, (old) =>
        old === undefined ? old : { ...old, watched: false, watchedAt: null },
      );
      const restoreTick = (): void => {
        if (before !== undefined) queryClient.setQueryData(key, before);
      };
      const resolution = await resolveEpisodeUnmark(runtime, episode.ids.trakt);
      if (resolution.kind === "error") {
        restoreTick();
        setError("Couldn't reach your history to unmark this. Please try again.");
        return;
      }
      if (resolution.kind === "rewatch") {
        // More than one play — refuse the wipe and keep the tick; per-play removal
        // is the Diary's job.
        restoreTick();
        setNotice(
          `This episode has ${resolution.count} plays — remove a specific one in your watch history.`,
        );
        return;
      }
      if (resolution.kind === "none") {
        // The server already holds no play for this episode; the optimistic un-tick
        // is correct — just reconcile the show's progress reads.
        revalidate(episode);
        return;
      }
      const op = buildRemovePlaysOp({
        opId: crypto.randomUUID(),
        ids: resolution.plan.removeIds,
        restore: resolution.plan.restore.map((r) => ({ trakt: r.trakt, watchedAt: r.watchedAt })),
      });
      const outcome = await submit([op], {
        rollback: restoreTick,
        revalidate: () => revalidate(episode),
      });
      if (outcome === "failed") setError("Couldn't update this episode. Please try again.");
    },
    [queryClient, submit, runtime, revalidate],
  );

  const toggle = useCallback(
    async (episode: EpisodeDetail) => {
      const key = queryKeys.episode(episode.showId, episode.season, episode.number);
      // Cancel in-flight reads so a settling refetch can't overwrite the flip.
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<EpisodeDetail>(key);
      setError(null);
      setNotice(null);
      if (episode.watched) await markOff(episode, key, before);
      else await markOn(episode, key, before);
    },
    [queryClient, markOn, markOff],
  );

  return {
    toggle,
    clearError: () => setError(null),
    notice,
    dismissNotice: () => setNotice(null),
    error,
  };
}
