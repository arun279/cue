import { invalidateShowProgress } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import { type CalendarDay, type CalendarRow, groupCalendar } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS, queryStatus } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useMemo, useState } from "react";
import { useQueuedWrite } from "./useQueuedWrite";

/** Window options: a one-week default, widened to a fortnight. */
export const CALENDAR_WINDOWS = [7, 14] as const;
const DEFAULT_CALENDAR_WINDOW = 7;

export interface CalendarView {
  readonly days: readonly CalendarDay[];
  readonly windowDays: number;
  setWindowDays(days: number): void;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  /** Epoch ms of the last successful sync — the pill's "· <time ago>" recency. */
  readonly syncedAt: number;
  refetch(): void;
  isWatched(episodeId: number): boolean;
  markWatched(row: CalendarRow): Promise<void>;
  /** Point-of-action Undo for the quick mark (the calendar's genuine reversal gap): the
   * last-marked row + its frozen watched_at, so Undo can remove exactly that play.
   * `episodeId` identifies the row so it hosts the INLINE Undo; the toast is the
   * secondary announce. */
  readonly undoable: { readonly showTitle: string; readonly episodeId: number } | null;
  undo(): Promise<void>;
  dismissUndo(): void;
  readonly markError: string | null;
  clearMarkError(): void;
}

interface CalendarUndo {
  readonly row: CalendarRow;
  readonly watchedAt: string;
}

/** `Date → "YYYY-MM-DD"` in the viewer's local tz, the `{start}` of the window request. */
function startDateOf(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: localTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The Upcoming/Calendar read hook. Fetches the personalized window
 * (widening refetches on a new `days` key), groups episodes by local day through
 * the pure domain `groupCalendar` (hidden shows excluded, aired rows flagged),
 * and exposes an optimistic quick mark-watched that rides the write-queue path.
 */
export function useCalendar(): CalendarView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_CALENDAR_WINDOW);
  const [watched, setWatched] = useState<ReadonlySet<number>>(() => new Set());
  const [undoState, setUndoState] = useState<CalendarUndo | null>(null);
  const write = useQueuedWrite();

  // The calendar mark + its Undo both refresh the calendar window (this episode
  // leaves/rejoins the unwatched-aired set) AND the marked show's detail reads via
  // `showProgressKeys`, else show-detail reads pre-mark progress until an unrelated
  // remote change — the same stale-cache defect the Up Next mark had.
  const revalidateFor = useCallback(
    (row: CalendarRow) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarPrefix() });
      invalidateShowProgress(queryClient, row.showId, { season: row.season, number: row.number });
    },
    [queryClient],
  );

  // TODO(calendar-now): the window anchor + grouping freeze "now" at mount, so a
  // session left open across the fixed-tz midnight can mislabel days and gate
  // mark-watched until an unrelated refetch. Refresh on the next day boundary.
  const startDate = useMemo(() => startDateOf(Date.now()), []);
  const query = useQuery({
    queryKey: queryKeys.calendar(startDate, windowDays),
    queryFn: () => runtime.loadCalendar(startDate, windowDays),
    // Time/content-driven, NOT gated on last_activities: newly-announced or
    // newly-aired future episodes don't always bump user activity.
    staleTime: CONTENT_STALE_TIME_MS,
  });

  const data = query.data;
  const days = useMemo<CalendarDay[]>(() => {
    if (data === undefined) return [];
    return groupCalendar(data.entries, {
      now: Date.now(),
      timeZone: localTimeZone(),
      hiddenShowIds: new Set(data.hiddenShowIds),
    });
  }, [data]);

  const unwatch = useCallback((episodeId: number) => {
    setWatched((prev) => {
      const next = new Set(prev);
      next.delete(episodeId);
      return next;
    });
  }, []);

  const markWatched = useCallback(
    async (row: CalendarRow) => {
      const episodeId = row.ids.trakt;
      if (watched.has(episodeId)) return;
      const watchedAt = new Date().toISOString();
      setWatched((prev) => new Set(prev).add(episodeId));
      // Confirmation + Undo at the point of action (the calendar gap): the row's
      // reversal is offered synchronously with the optimistic tick, not gated behind
      // the paced write settling.
      setUndoState({ row, watchedAt });
      const op = buildMarkEpisodeOp({
        opId: crypto.randomUUID(),
        ids: row.ids,
        watchedAt,
        // No progress is loaded on this surface; anchor on 0 like the episode-detail
        // toggle does — a lost-response reconcile then retires on any fresh play.
        inversePatch: { showId: row.showId, preCompleted: 0 },
      });
      await write.run(
        op,
        () => {
          unwatch(episodeId);
          // Drop the now-invalid Undo only if it's still this row's (a newer mark may
          // already own the slot).
          setUndoState((cur) => (cur?.row.ids.trakt === episodeId ? null : cur));
        },
        `Couldn't mark ${row.showTitle} watched. Please try again.`,
        () => revalidateFor(row),
      );
    },
    [watched, write, revalidateFor, unwatch],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    const episodeId = pending.row.ids.trakt;
    unwatch(episodeId);
    // The compensating remove is keyed by episode item, so it removes ALL plays of
    // this episode — exact for the just-marked play (a calendar row is a freshly-aired
    // episode with no prior play in the app's single-play model). The exact per-play
    // removal (by history event id) is the Diary's `buildRemoveHistoryPlayOp`; that id
    // lives only in `/users/me/history`, not at this point-of-action undo, so the
    // item-scoped remove is the correct reversal here.
    const op = buildUnmarkEpisodeOp({
      opId: crypto.randomUUID(),
      ids: pending.row.ids,
      watchedAt: pending.watchedAt,
      inversePatch: { showId: pending.row.showId, preCompleted: 0 },
    });
    // A hard-failed removal must re-tick the row (Trakt still holds the play); a
    // deferred removal keeps the undone state (the shared seam owns that rule).
    await write.run(
      op,
      () => setWatched((prev) => new Set(prev).add(episodeId)),
      `Couldn't undo ${pending.row.showTitle}. Please try again.`,
      () => revalidateFor(pending.row),
    );
  }, [undoState, write, revalidateFor, unwatch]);

  return {
    days,
    windowDays,
    setWindowDays,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
    isWatched: (episodeId) => watched.has(episodeId),
    markWatched,
    undoable:
      undoState === null
        ? null
        : { showTitle: undoState.row.showTitle, episodeId: undoState.row.ids.trakt },
    undo,
    dismissUndo: () => setUndoState(null),
    markError: write.error,
    clearMarkError: write.clearError,
  };
}
