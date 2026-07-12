import type { LibraryEntry } from "@data/trakt/library";
import type { MovieEntry } from "@data/trakt/movie-library";
import type { LibrarySort } from "@domain/library-buckets";
import { isAired } from "@domain/time";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { ActionSheet, type ActionSheetRow } from "@ui/components/ActionSheet";
import { Chip } from "@ui/components/Chip";
import { ContextMenu } from "@ui/components/ContextMenu";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { SegmentedControl } from "@ui/components/SegmentedControl";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { epCode } from "@ui/format";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useHideShow } from "@ui/hooks/useHideShow";
import { type LibraryChipKey, useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { useMarkWatched } from "@ui/hooks/useMarkWatched";
import { useMovieActions } from "@ui/hooks/useMovieActions";
import { type MovieSort, useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { usePrefs } from "@ui/prefs/prefs-store";
import { ArrowUpDown, Check, Search as SearchIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { MovieTile } from "./MovieTile";
import { PosterGrid } from "./PosterGrid";
import { ShowTile } from "./ShowTile";

const SORT_LABEL: Record<LibrarySort, string> = {
  "recently-watched": "Recently watched",
  alphabetical: "A-Z",
  progress: "Progress",
};
const SORTS: readonly LibrarySort[] = ["recently-watched", "alphabetical", "progress"];

/** Movie sort keys: parity of placement with Shows, honest options: "Progress" is
 * meaningless for a binary movie, so Release year replaces it. */
const MOVIE_SORT_LABEL: Record<MovieSort, string> = {
  "recently-watched": "Recently added/watched",
  alphabetical: "A-Z",
  "release-year": "Release year",
};
const MOVIE_SORTS: readonly MovieSort[] = ["recently-watched", "alphabetical", "release-year"];

type MovieChipKey = "watchlist" | "watched";

const SHOW_CHIP_KEYS: readonly LibraryChipKey[] = [
  "watching",
  "watchlist",
  "stopped",
  "finished",
  "syncing",
];
const MOVIE_CHIP_KEYS: readonly MovieChipKey[] = ["watchlist", "watched"];

/** Exactly one chip is active; the last choice is remembered per segment. */
const SHOW_CHIP_STORAGE = "cue.library-chip";
const MOVIE_CHIP_STORAGE = "cue.library-movie-chip";

const SHOW_CHIP_LABEL: Record<LibraryChipKey, string> = {
  watching: "Watching",
  watchlist: "Watchlist",
  stopped: "Stopped",
  finished: "Finished",
  syncing: "Still syncing",
};

/** Genuine emptiness per chip reads as orientation, never as failure. */
const SHOW_CHIP_EMPTY: Record<LibraryChipKey, string> = {
  watching: "Shows you're watching land here. Find one in Search.",
  watchlist: "Things you want to watch land here. Add them from Search.",
  stopped: "Shows you stop keep their progress. Resume any time.",
  finished: "Shows you finish land here.",
  syncing: "Nothing is waiting on a sync.",
};
const MOVIE_CHIP_EMPTY: Record<MovieChipKey, string> = {
  watchlist: "Things you want to watch land here. Add them from Search.",
  watched: "Movies you watch land here.",
};

/**
 * Debounce before the title filter applies: below the ~1s that reads as
 * sluggish, above a fast typist's inter-keystroke gap, so a mid-word burst
 * filters the grid once rather than thrashing on every keystroke.
 */
const FILTER_DEBOUNCE_MS = 300;

function readChip<T extends string>(storageKey: string, valid: readonly T[]): T | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return valid.find((key) => key === raw) ?? null;
  } catch {
    return null;
  }
}

function persistChip(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // A private-mode storage failure just forgets the chip next visit: non-fatal.
  }
}

/**
 * Library: one screen frame shared by Shows and Movies. A Shows⇄Movies
 * segment (URL `?type`), a tap-to-reveal title filter, a per-segment sort
 * sheet, and a row of status chips, exactly one active, over a virtualized
 * 3-column poster grid. The taxonomy stays honest: shows carry their
 * progress-derived chips; movies get Watchlist / Watched, no fabricated
 * episode progress on a film. Long-press on a tile opens its quick actions
 * (mark next episode, stop/resume, details); there is deliberately no
 * "remove from library": no single Trakt op backs it.
 */
export function Library(): ReactElement {
  useDocumentTitle("Library · Cue");
  const { type } = useSearch({ from: "/library" });
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  // With both media on, the URL `?type` picks the segment (Shows is the default).
  // A single-medium user is pinned to their medium and shown no toggle.
  const bothEnabled = showsEnabled && moviesEnabled;
  const isMovies = moviesEnabled && (!showsEnabled || type === "movies");
  const navigate = useNavigate();

  const [showSort, setShowSort] = useState<LibrarySort>("recently-watched");
  const [movieSort, setMovieSort] = useState<MovieSort>("recently-watched");
  const [showChip, setShowChip] = useState<LibraryChipKey>(
    () => readChip(SHOW_CHIP_STORAGE, SHOW_CHIP_KEYS) ?? "watching",
  );
  const [movieChip, setMovieChip] = useState<MovieChipKey>(
    () => readChip(MOVIE_CHIP_STORAGE, MOVIE_CHIP_KEYS) ?? "watchlist",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // Only the ACTIVE medium's read fires, keeping a background segment off
  // Trakt's rate budget; the persisted cache makes the first switch instant.
  const view = useLibraryBuckets(showSort, showsEnabled && !isMovies);
  const movieView = useMovieLibrary(movieSort, isMovies);
  const hideShow = useHideShow();
  const mark = useMarkWatched();
  const movieActions = useMovieActions();
  const active = isMovies ? movieView : view;

  useEffect(() => {
    const timer = setTimeout(() => setFilter(query.trim().toLowerCase()), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [filterOpen]);

  const { undoable: hideUndoable, error: hideError, undo: hideUndo, clearError } = hideShow;
  useEffect(() => {
    if (hideError !== null) {
      showSnack({
        message: hideError,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              clearError();
              dismissSnack();
            },
          },
        ],
      });
      return;
    }
    if (hideUndoable !== null) {
      showSnack({
        message: `${hideUndoable.title} ${hideUndoable.kind === "hide" ? "stopped" : "resumed"}`,
        actions: [
          {
            label: "Undo",
            testId: "snackbar-undo",
            onPress: () => {
              dismissSnack();
              void hideUndo();
            },
          },
        ],
      });
    }
  }, [hideUndoable, hideError, hideUndo, clearError]);

  const {
    undoable: movieUndoable,
    error: movieError,
    notice: movieNotice,
    undoMark,
    clearError: movieClearError,
    dismissNotice,
  } = movieActions;
  useEffect(() => {
    if (movieError !== null) {
      showSnack({
        message: movieError,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              movieClearError();
              dismissSnack();
            },
          },
        ],
      });
      return;
    }
    if (movieNotice !== null) {
      showSnack({
        message: movieNotice,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              dismissNotice();
              dismissSnack();
            },
          },
        ],
      });
      return;
    }
    if (movieUndoable !== null) {
      showSnack({
        message: `${movieUndoable.title} marked`,
        actions: [
          {
            label: "Undo",
            testId: "snackbar-undo",
            onPress: () => {
              dismissSnack();
              void undoMark();
            },
          },
        ],
      });
    }
  }, [movieUndoable, movieError, movieNotice, undoMark, movieClearError, dismissNotice]);

  // Clearing must reset both the input and the debounced filter synchronously,
  // or the stale filter lingers for the debounce window.
  const clearFilter = (): void => {
    setQuery("");
    setFilter("");
  };

  const toggleFilter = (): void => {
    if (filterOpen) clearFilter();
    setFilterOpen((open) => !open);
  };

  const onSegment = (value: "shows" | "movies"): void => {
    // The toggle is view-state, not a distinct page: replace (don't push) so
    // Back skips past it. The filter is session-scoped per segment visit, so a
    // show query never carries into the movie library.
    clearFilter();
    setFilterOpen(false);
    void navigate({
      to: "/library",
      search: value === "movies" ? { type: "movies" } : {},
      replace: true,
    });
  };

  const movieEntriesFor = (key: MovieChipKey): readonly MovieEntry[] =>
    movieView.segments.find((segment) => segment.key === key)?.entries ?? [];

  const showChipKeys = SHOW_CHIP_KEYS.filter(
    (key) => key !== "syncing" || view.chips.syncing.length > 0,
  );

  // A persisted "Still syncing" chip whose bucket has since drained falls back
  // to Watching rather than pointing at a chip that no longer renders.
  const activeShowChip =
    showChip === "syncing" && view.chips.syncing.length === 0 ? "watching" : showChip;
  const activeChipKey = isMovies ? movieChip : activeShowChip;

  const sortRows: ActionSheetRow[] = isMovies
    ? MOVIE_SORTS.map((option) => ({
        label: MOVIE_SORT_LABEL[option],
        icon: movieSort === option ? <Check /> : undefined,
        testId: `sort-${option}`,
        onPress: () => setMovieSort(option),
      }))
    : SORTS.map((option) => ({
        label: SORT_LABEL[option],
        icon: showSort === option ? <Check /> : undefined,
        testId: `sort-${option}`,
        onPress: () => setShowSort(option),
      }));

  const showIdsOf = (entry: LibraryEntry): { trakt: number; tmdb?: number } => ({
    trakt: entry.showId,
    tmdb: entry.tmdbId ?? undefined,
  });

  const showRows = (entry: LibraryEntry): ActionSheetRow[] => {
    const rows: ActionSheetRow[] = [];
    const next = entry.nextEpisode;
    // The expert accelerator rides the exact queue pipeline (optimistic patch,
    // batch snackbar, reverse window) and only offers itself when the next
    // episode is known and aired, never a guessed coordinate.
    if (
      entry.progressKnown &&
      !entry.pendingAdvance &&
      next !== null &&
      isAired(next.firstAired, Date.now())
    ) {
      rows.push({
        label: `Mark ${epCode(next.season, next.number)} watched`,
        testId: "quick-mark",
        onPress: () => void mark.mark(entry),
      });
    }
    rows.push(
      entry.hidden
        ? {
            label: "Resume show",
            testId: "quick-resume",
            onPress: () => void hideShow.unhide(entry.showId, showIdsOf(entry), entry.title),
          }
        : {
            label: "Stop show",
            testId: "quick-stop",
            onPress: () => void hideShow.hide(entry.showId, showIdsOf(entry), entry.title),
          },
    );
    rows.push({
      label: "Show details",
      testId: "quick-details",
      onPress: () =>
        void navigate({ to: "/show/$showId", params: { showId: String(entry.showId) } }),
    });
    return rows;
  };

  const removeFromWatchlist = (entry: MovieEntry): void => {
    void movieActions.toggleWatchlist(entry);
    showSnack({
      message: `${entry.title} removed from Watchlist`,
      actions: [
        {
          label: "Undo",
          testId: "snackbar-undo",
          onPress: () => {
            dismissSnack();
            const current = movieView.entryFor(entry.movieId);
            if (current !== undefined && !current.inWatchlist) {
              void movieActions.toggleWatchlist(current);
            }
          },
        },
      ],
    });
  };

  const movieRows = (entry: MovieEntry): ActionSheetRow[] => {
    const rows: ActionSheetRow[] = [];
    if (!entry.watched) {
      rows.push({
        label: "Mark watched",
        testId: "quick-mark",
        onPress: () => void movieActions.markWatched(entry),
      });
    }
    if (entry.inWatchlist) {
      rows.push({
        label: "Remove from Watchlist",
        testId: "quick-remove-watchlist",
        onPress: () => removeFromWatchlist(entry),
      });
    }
    rows.push({
      label: "Show details",
      testId: "quick-details",
      onPress: () =>
        void navigate({ to: "/movie/$movieId", params: { movieId: String(entry.movieId) } }),
    });
    return rows;
  };

  const filtering = filter.length > 0;
  const matches = <E extends { readonly title: string }>(entries: readonly E[]): readonly E[] =>
    filtering ? entries.filter((entry) => entry.title.toLowerCase().includes(filter)) : entries;

  const emptyBlock = (): ReactNode => (
    <div className="library-empty" data-testid={`library-empty-${activeChipKey}`}>
      <p>
        {filtering
          ? `No ${isMovies ? "movies" : "shows"} match "${filter}".`
          : isMovies
            ? MOVIE_CHIP_EMPTY[movieChip]
            : SHOW_CHIP_EMPTY[activeShowChip]}
      </p>
      {filtering ? (
        <button type="button" className="button button--ghost" onClick={clearFilter}>
          Clear filter
        </button>
      ) : (
        !isMovies &&
        activeShowChip === "watching" && (
          <Link to="/search" className="button" data-testid="library-search-shows">
            Search shows
          </Link>
        )
      )}
    </div>
  );

  let body: ReactNode;
  if (active.isLoading) {
    body = <LibrarySkeleton testId="library-skeleton" />;
  } else if (active.isError && !active.hasData) {
    body = (
      <ErrorRetry
        title={isMovies ? "Couldn't load your movies" : "Couldn't load your library"}
        testId="library-error"
        buttonTestId="library-error-retry"
        onRetry={active.refetch}
      />
    );
  } else if (isMovies) {
    const shown = matches(movieEntriesFor(movieChip));
    body =
      shown.length === 0 ? (
        emptyBlock()
      ) : (
        <PosterGrid
          entries={shown}
          keyOf={(entry) => entry.movieId}
          renderCell={(entry) => (
            <ContextMenu title={entry.title} rows={movieRows(entry)}>
              <MovieTile entry={entry} />
            </ContextMenu>
          )}
        />
      );
  } else {
    const shown = matches(view.chips[activeShowChip]);
    body =
      shown.length === 0 ? (
        emptyBlock()
      ) : (
        <PosterGrid
          entries={shown}
          keyOf={(entry) => entry.showId}
          renderCell={(entry) => (
            <ContextMenu title={entry.title} rows={showRows(entry)}>
              <ShowTile entry={entry} chip={activeShowChip} />
            </ContextMenu>
          )}
        />
      );
  }

  return (
    <section className="screen-library" data-testid="screen-library">
      <ScreenHeader title="Library" variant="root" />
      <SyncStrip isError={active.isError} onRetry={active.refetch} />

      <div className="library-toolbar">
        {bothEnabled && (
          <SegmentedControl
            options={[
              { value: "shows", label: "Shows", testId: "type-shows" },
              { value: "movies", label: "Movies", testId: "type-movies" },
            ]}
            value={isMovies ? "movies" : "shows"}
            onChange={onSegment}
            ariaLabel="Library type"
          />
        )}
        <span className="library-toolbar__spacer" />
        <button
          type="button"
          className="library-tool"
          aria-label="Filter by title"
          aria-expanded={filterOpen}
          data-testid="library-filter-toggle"
          onClick={toggleFilter}
        >
          <SearchIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          className="library-tool"
          aria-label="Sort"
          data-testid="library-sort"
          onClick={() => setSortOpen(true)}
        >
          <ArrowUpDown aria-hidden="true" />
        </button>
      </div>

      {filterOpen && (
        <div className="library-filter-row">
          <input
            ref={filterRef}
            type="search"
            className="library-filter-field"
            placeholder="Filter by title…"
            aria-label="Filter by title"
            autoComplete="off"
            data-testid="library-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}

      <div className="library-chips" data-testid="library-chips">
        {isMovies
          ? MOVIE_CHIP_KEYS.map((key) => (
              <Chip
                key={key}
                variant="status"
                label={key === "watchlist" ? "Watchlist" : "Watched"}
                count={movieEntriesFor(key).length}
                selected={key === movieChip}
                testId={`chip-${key}`}
                onPress={() => {
                  setMovieChip(key);
                  persistChip(MOVIE_CHIP_STORAGE, key);
                }}
              />
            ))
          : showChipKeys.map((key) => (
              <Chip
                key={key}
                variant="status"
                label={SHOW_CHIP_LABEL[key]}
                count={view.chips[key].length}
                selected={key === activeShowChip}
                testId={`chip-${key}`}
                onPress={() => {
                  setShowChip(key);
                  persistChip(SHOW_CHIP_STORAGE, key);
                }}
              />
            ))}
      </div>

      {body}

      <ActionSheet open={sortOpen} onOpenChange={setSortOpen} title="Sort by" rows={sortRows} />
    </section>
  );
}
