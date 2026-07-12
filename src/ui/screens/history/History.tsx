import type { HistoryEntry } from "@domain/history";
import { localTimeZone } from "@domain/time";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { Badge } from "@ui/components/Badge";
import { CheckControl } from "@ui/components/CheckControl";
import { Chip } from "@ui/components/Chip";
import { ContextMenu } from "@ui/components/ContextMenu";
import { EmptyState } from "@ui/components/EmptyState";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { SkeletonRows } from "@ui/components/Skeletons";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type HistoryFilter, type HistoryScope, useHistory } from "@ui/hooks/useHistory";
import { useRemovalSnacks } from "@ui/hooks/useRemovalSnacks";
import { usePrefs } from "@ui/prefs/prefs-store";
import { Poster } from "@ui/screens/up-next/Poster";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { HistorySearch } from "./HistorySearch";
import {
  buildBlocks,
  countItemPlays,
  entryDetail,
  entryLink,
  type HistoryRowVM,
  jumpLabel,
} from "./history-view";
import { type HistoryJumpScope, MonthJumpSheet } from "./MonthJumpSheet";

const FILTERS: readonly { readonly value: HistoryFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "tv", label: "Shows" },
  { value: "movies", label: "Movies" },
];

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

function HistoryRow({
  row,
  onRemove,
  onGoTo,
}: {
  readonly row: HistoryRowVM;
  onRemove(row: HistoryRowVM): void;
  onGoTo(entry: HistoryEntry): void;
}): ReactElement {
  const { entry } = row;
  const detail = entryDetail(entry);
  return (
    <ContextMenu
      title={entry.title}
      rows={[
        {
          label: entry.type === "movie" ? "Go to movie" : "Go to episode",
          testId: "history-menu-open",
          onPress: () => onGoTo(entry),
        },
        {
          label: "Remove this play",
          danger: true,
          testId: "history-menu-remove",
          onPress: () => onRemove(row),
        },
      ]}
    >
      <EpisodeRow
        variant="history"
        testId="history-row"
        art={
          <>
            <time className="hist-time" dateTime={entry.watchedAt}>
              {timeFmt.format(new Date(entry.watchedAt))}
            </time>
            <Poster title={entry.title} posters={entry.posters} variant="s32" />
          </>
        }
        title={
          <>
            <span className="hist-title">
              <strong>{entry.title}</strong> · {detail}
            </span>
            {row.plays > 1 && (
              <Badge variant="plays" testId="history-plays">
                ×{row.plays}
              </Badge>
            )}
          </>
        }
        trailing={
          <CheckControl
            state="watched"
            size={44}
            label="Watched. Tap to remove."
            onPress={() => onRemove(row)}
          />
        }
        link={entryLink(entry)}
        linkLabel={`${entry.title} · ${detail}`}
      />
    </ContextMenu>
  );
}

function HistorySkeleton(): ReactElement {
  return (
    <div aria-hidden="true" data-testid="history-skeleton">
      <span className="skeleton-row__bar hist-skel-day" />
      <SkeletonRows rows={4} />
    </div>
  );
}

/** The human scope label for empty states: "2019" or "Mar 2019". */
function scopeLabel(year: number | undefined, month: number | undefined): string | null {
  return year === undefined ? null : jumpLabel(year, month, Date.now());
}

/**
 * Watch history: Cue's past tense on its own route, reached from Profile. A
 * reverse-chronological log grouped by local day, with a type filter, an
 * in-header title filter over the loaded window, and a month/year jump. A
 * decade-deep account teleports to any window instead of scrolling forever.
 * Scrolling pages in more history by itself. Every filled check is the durable
 * unmark path: a tap removes exactly that play (by history event id),
 * optimistically, with a snackbar Undo; long-press offers the same plus
 * navigation. The scope lives in the URL (`?type`/`?year`/`?month`), so every
 * window is deep-linkable.
 */
export function History(): ReactElement {
  useDocumentTitle("History · Cue");
  const { type, year, month } = useSearch({ from: "/history" });
  const navigate = useNavigate();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);

  // A single-medium user is pinned to their medium and shown no filter chips:
  // the same "one active medium shows no toggle" idiom as the Library.
  const lockedFilter: HistoryFilter | undefined = !moviesEnabled
    ? "tv"
    : !showsEnabled
      ? "movies"
      : undefined;
  const filter: HistoryFilter = lockedFilter ?? type ?? "all";
  const scope: HistoryScope = { filter, year, month };
  const view = useHistory(scope);

  const [titleQuery, setTitleQuery] = useState("");
  const [jumpOpen, setJumpOpen] = useState(false);

  const blocks = useMemo(() => buildBlocks(view.days, titleQuery), [view.days, titleQuery]);

  // The removal wrapper stamps how many plays of the item remain in the loaded
  // window BEFORE the optimistic hide, so the snackbar effect (which fires after
  // the hide) can honestly say "Removed 1 play · N remain" without re-deriving
  // state that has already shifted under it.
  const lastRemoval = useRef<{ readonly historyId: number; readonly remain: number } | null>(null);
  const removeRow = (row: HistoryRowVM): void => {
    lastRemoval.current = {
      historyId: row.entry.historyId,
      remain: countItemPlays(view.days, row.entry) - 1,
    };
    void view.removePlay(row.entry);
  };

  useRemovalSnacks(view, (entry) => {
    const removal = lastRemoval.current;
    const remain = removal !== null && removal.historyId === entry.historyId ? removal.remain : 0;
    return remain > 0
      ? `Removed 1 play · ${remain} remain${remain === 1 ? "s" : ""}`
      : "Removed play";
  });

  // Infinite scroll: a sentinel below the list pulls the next page as it nears
  // the viewport. A failed page falls back to the explicit Retry button (no
  // observer), so an outage can't hammer the endpoint on every scroll twitch.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasMore, isLoadingMore, isLoadMoreError, loadEarlier } = view;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || !hasMore || isLoadingMore || isLoadMoreError) return;
    const observer = new IntersectionObserver(
      (hits) => {
        if (hits.some((hit) => hit.isIntersecting)) loadEarlier();
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isLoadMoreError, loadEarlier]);

  const setFilter = (value: HistoryFilter): void => {
    void navigate({
      to: "/history",
      search: (prev) => ({ ...prev, type: value === "all" ? undefined : value }),
      replace: true,
    });
  };

  const jumpTo = (target: HistoryJumpScope): void => {
    void navigate({
      to: "/history",
      // A month is meaningless without its year, so clearing the year clears both.
      search: (prev) => ({
        ...prev,
        year: target.year,
        month: target.year === undefined ? undefined : target.month,
      }),
    });
  };

  const goTo = (entry: HistoryEntry): void => {
    void navigate(entryLink(entry));
  };

  const label = scopeLabel(year, month);
  const filtering = titleQuery.trim() !== "";

  let body: ReactNode;
  if (view.isLoading) {
    body = <HistorySkeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <ErrorRetry
        title="Couldn't load your history"
        testId="history-error"
        buttonTestId="history-error-retry"
        onRetry={view.refetch}
      />
    );
  } else if (view.isEmpty && !filtering) {
    body =
      label === null ? (
        <EmptyState
          testId="history-empty"
          headline="Nothing logged yet."
          body="Everything you mark lands here and can be removed here."
        />
      ) : (
        <EmptyState
          testId="history-empty"
          headline={`Nothing watched in ${label}.`}
          body="No plays fall in this window. Pick another month, or head back to recent history."
        >
          <button
            type="button"
            className="button"
            data-testid="history-empty-recent"
            onClick={() => jumpTo({})}
          >
            Back to recent
          </button>
        </EmptyState>
      );
  } else if (blocks.length === 0 && filtering) {
    body = (
      <EmptyState
        testId="history-filter-empty"
        headline="No titles match."
        body={`Nothing loaded matches "${titleQuery.trim()}". Scroll loads more history to search.`}
      />
    );
  } else {
    body = (
      <>
        {blocks.map((block) =>
          block.kind === "year" ? (
            <h2 key={`year-${block.year}`} className="hist-year" data-testid="history-year">
              {block.year}
            </h2>
          ) : (
            <section key={block.day.dayKey} className="hist-day-group">
              <h3 className="hist-day" data-testid="history-day-heading">
                {block.day.label}
                <span className="hist-day__count"> · {block.day.rollup}</span>
              </h3>
              <ul className="row-list">
                {block.day.rows.map((row) => (
                  <li key={row.entry.historyId}>
                    <HistoryRow row={row} onRemove={removeRow} onGoTo={goTo} />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
        {hasMore && (
          <div className="hist-more">
            {isLoadingMore && <SkeletonRows rows={2} testId="history-loading-more" />}
            {isLoadMoreError && !isLoadingMore && (
              <>
                <p
                  className="hist-more__error"
                  role="alert"
                  data-testid="history-load-earlier-error"
                >
                  Couldn't load earlier history.
                </p>
                <button
                  type="button"
                  className="button button--ghost"
                  data-testid="history-load-earlier"
                  onClick={loadEarlier}
                >
                  Retry
                </button>
              </>
            )}
            <div ref={sentinelRef} className="hist-sentinel" aria-hidden="true" />
          </div>
        )}
      </>
    );
  }

  return (
    <section className="screen-history" data-testid="screen-history">
      <ScreenHeader
        title="History"
        variant="child"
        trailing={<HistorySearch value={titleQuery} onChange={setTitleQuery} />}
      />
      <SyncStrip isError={view.isError} onRetry={view.refetch} />

      <div className="hist-filters">
        {lockedFilter === undefined && (
          <fieldset className="hist-filters__chips">
            <legend className="sr-only">History type</legend>
            {FILTERS.map((option) => (
              <Chip
                key={option.value}
                variant="filter"
                label={option.label}
                selected={filter === option.value}
                testId={`history-filter-${option.value}`}
                onPress={() => setFilter(option.value)}
              />
            ))}
          </fieldset>
        )}
        <Chip
          variant="month-jump"
          label={jumpLabel(year, month, Date.now())}
          testId="history-jump"
          onPress={() => setJumpOpen(true)}
        />
      </div>

      {body}

      <MonthJumpSheet
        open={jumpOpen}
        onOpenChange={setJumpOpen}
        year={year}
        month={month}
        onPick={jumpTo}
      />
    </section>
  );
}
