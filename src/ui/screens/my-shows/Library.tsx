import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import type { MovieEntry } from "@data/trakt/movie-library";
import type { LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useHideShow } from "@ui/hooks/useHideShow";
import { useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { type MovieSort, useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { formatAirDate } from "@ui/screens/up-next/format";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion, ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { MoviePosterCard } from "./MoviePosterCard";
import { PosterCard } from "./PosterCard";
import { PosterGrid } from "./PosterGrid";

/** Plain, real-world segment labels. Watchlist (not-started) is framed as the
 * things you chose to start — never a "backlog". "Finished"/"Stopped" replace the
 * internal "Ended"/"Abandoned"; the derived enum values (data-status) stay put. */
const PILE_LABEL: Partial<Record<WatchStatus, string>> = {
  "not-started": "Watchlist",
  watching: "Watching",
  "caught-up": "Caught up",
  ended: "Finished",
  abandoned: "Stopped",
};

const SORT_LABEL: Record<LibrarySort, string> = {
  "recently-watched": "Recently watched",
  alphabetical: "A–Z",
  progress: "Progress",
};
const SORTS: readonly LibrarySort[] = ["recently-watched", "alphabetical", "progress"];

/** Movie sort keys: parity of placement with Shows, honest options — "Progress" is
 * meaningless for a binary movie, so Release year replaces it. */
const MOVIE_SORT_LABEL: Record<MovieSort, string> = {
  "recently-watched": "Recently watched",
  alphabetical: "A–Z",
  "release-year": "Release year",
};
const MOVIE_SORTS: readonly MovieSort[] = ["recently-watched", "alphabetical", "release-year"];

type MovieSegmentKey = "watchlist" | "watched";
const MOVIE_SEGMENT_KEYS: readonly MovieSegmentKey[] = ["watchlist", "watched"];

/** Watching opens on first visit for Shows; Watchlist (the actionable pool) opens
 * first for Movies. Every other segment stays collapsed as a labelled, counted
 * header (recognition over recall) until the user reaches for it. */
const DEFAULT_OPEN: readonly WatchStatus[] = ["watching"];
const OPEN_KEY = "cue.piles-open";
const MOVIE_DEFAULT_OPEN: readonly MovieSegmentKey[] = ["watchlist"];
const MOVIE_OPEN_KEY = "cue.movie-piles-open";

/**
 * Reuse the Discover settle delay (300ms): below the ~1s that reads as sluggish,
 * above a fast typist's inter-keystroke gap, so a mid-word burst expands the piles
 * once rather than thrashing on every keystroke.
 */
const FILTER_DEBOUNCE_MS = 300;

const isPileStatus = (v: string): v is WatchStatus => Object.hasOwn(PILE_LABEL, v);
const isMovieSegment = (v: string): v is MovieSegmentKey =>
  (MOVIE_SEGMENT_KEYS as readonly string[]).includes(v);

/** Read a persisted open-segment set for either taxonomy, keeping only keys still
 * valid for that view and falling back to the default open set. */
function readOpenSet<T extends string>(
  storageKey: string,
  fallback: readonly T[],
  valid: (v: string) => v is T,
): T[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return [...fallback];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...fallback];
    return parsed.filter((v): v is T => typeof v === "string" && valid(v));
  } catch {
    return [...fallback];
  }
}

function persistOpen(storageKey: string, value: readonly string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // A private-mode storage failure just forgets the layout next visit — non-fatal.
  }
}

interface SegmentSource<E> {
  readonly key: string;
  readonly label: string;
  /** Shows carry a derived `WatchStatus` for per-status styling; movies leave it unset. */
  readonly status?: WatchStatus;
  readonly entries: readonly E[];
}

interface SegmentPile<E> {
  readonly key: string;
  readonly label: string;
  readonly status?: WatchStatus;
  readonly total: number;
  /** Tiles to render — every entry when idle, only title matches while filtering. */
  readonly shown: readonly E[];
}

/** Apply the debounced cross-segment title filter to a taxonomy's segments,
 * carrying total + matched counts for the header badge. Shared by both views. */
function filterSegments<E extends { readonly title: string }>(
  sources: readonly SegmentSource<E>[],
  filter: string,
): SegmentPile<E>[] {
  const filtering = filter.length > 0;
  return sources.map((source) => ({
    key: source.key,
    label: source.label,
    status: source.status,
    total: source.entries.length,
    shown: filtering
      ? source.entries.filter((entry) => entry.title.toLowerCase().includes(filter))
      : source.entries,
  }));
}

/** The shared collapsible-segment body: a Radix Accordion where each item is a
 * disclosure header (chevron + name + right-aligned count badge) over a
 * PosterGrid. Identical chrome for Shows and Movies; only the cell renderer and
 * entry type differ (Shneiderman #1 / Nielsen #4 consistency). */
function SegmentAccordion<E>({
  piles,
  openValue,
  onOpenChange,
  filtering,
  keyOf,
  renderCell,
}: {
  readonly piles: readonly SegmentPile<E>[];
  readonly openValue: string[];
  onOpenChange(values: string[]): void;
  readonly filtering: boolean;
  keyOf(entry: E): string | number;
  renderCell(entry: E, pile: SegmentPile<E>): ReactNode;
}): ReactElement {
  return (
    <Accordion.Root
      type="multiple"
      className="piles"
      value={openValue}
      onValueChange={onOpenChange}
    >
      {piles.map((pile) => (
        <Accordion.Item key={pile.key} className="pile" value={pile.key} data-status={pile.status}>
          <Accordion.Header className="pile__header">
            <Accordion.Trigger
              className="pile__trigger"
              data-testid="pile-heading"
              data-status={pile.status}
            >
              <svg
                className="pile__chevron"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="pile__name">{pile.label}</span>
              <span className="pile__count library-heading__count" data-testid="pile-count">
                {filtering ? `${pile.shown.length}/${pile.total}` : pile.total}
              </span>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="pile__content">
            <PosterGrid
              entries={pile.shown}
              keyOf={keyOf}
              renderCell={(entry: E) => renderCell(entry, pile)}
            />
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}

/** A single Stopped tile — the whole PosterCard links to Show detail, with the
 * Resume recovery action pinned as a sibling overlay (never a nested control).
 * Stopping keeps your history; Resume just brings the show back into your library. */
function StoppedTile({
  entry,
  tmdbConfig,
  onResume,
}: {
  readonly entry: LibraryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
  onResume(): void;
}): ReactElement {
  return (
    <div className="pile-tile">
      <PosterCard entry={entry} tmdbConfig={tmdbConfig} />
      <button
        type="button"
        className="pile-tile__resume"
        data-testid="resume"
        data-show-id={entry.showId}
        onClick={onResume}
      >
        Resume
      </button>
    </div>
  );
}

/** A Caught-up tile: the shared PosterCard plus a quiet "returning <date>" caption
 * when the next (unaired) episode has a known air date — the "Caught up · returning
 * Mar 2027" reading, split across the segment header and this per-tile note. */
function CaughtUpTile({
  entry,
  tmdbConfig,
}: {
  readonly entry: LibraryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
}): ReactElement {
  const returning = entry.nextEpisode === null ? null : formatAirDate(entry.nextEpisode.firstAired);
  return (
    <div className="pile-tile">
      <PosterCard entry={entry} tmdbConfig={tmdbConfig} />
      {returning !== null && (
        <p className="pile-tile__note" data-testid="returning-note">
          · returning {returning}
        </p>
      )}
    </div>
  );
}

/**
 * Library — one screen frame and control set shared by Shows and Movies.
 * A Shows⇄Movies segmented toggle (URL `?type`), a debounced cross-segment filter,
 * a media-appropriate Sort control, and a Radix Accordion of collapsible segments
 * (chevron + count badge over the shared PosterGrid) render identically for both.
 * The TAXONOMY stays honest: Shows keep their five progress-derived piles;
 * movies get Watchlist / Watched — no fabricated episode-progress on a film
 * (Rams #6). Every state is designed: skeleton, hard error, cached-error banner,
 * empty library, only-stopped library, and no-filter-match.
 */
export function Library(): ReactElement {
  useDocumentTitle("Library · Cue");
  const { type } = useSearch({ from: "/library" });
  const isMovies = type === "movies";
  const navigate = useNavigate();

  const [showSort, setShowSort] = useState<LibrarySort>("recently-watched");
  const [movieSort, setMovieSort] = useState<MovieSort>("recently-watched");
  const [openPiles, setOpenPiles] = useState<WatchStatus[]>(() =>
    readOpenSet(OPEN_KEY, DEFAULT_OPEN, isPileStatus),
  );
  const [openMovies, setOpenMovies] = useState<MovieSegmentKey[]>(() =>
    readOpenSet(MOVIE_OPEN_KEY, MOVIE_DEFAULT_OPEN, isMovieSegment),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");

  const view = useLibraryBuckets(showSort);
  const movieView = useMovieLibrary(movieSort);
  const unhide = useHideShow();
  const active = isMovies ? movieView : view;

  useEffect(() => {
    const timer = setTimeout(() => setFilter(query.trim().toLowerCase()), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = filter.length > 0;

  const showSources = useMemo<SegmentSource<LibraryEntry>[]>(
    () =>
      view.buckets.map((bucket) => ({
        key: bucket.status,
        label: PILE_LABEL[bucket.status] ?? bucket.status,
        status: bucket.status,
        entries: bucket.entries,
      })),
    [view.buckets],
  );
  const movieSources = useMemo<SegmentSource<MovieEntry>[]>(
    () =>
      movieView.segments.map((segment) => ({
        key: segment.key,
        label: segment.label,
        entries: segment.entries,
      })),
    [movieView.segments],
  );

  const showPiles = useMemo(() => filterSegments(showSources, filter), [showSources, filter]);
  const moviePiles = useMemo(() => filterSegments(movieSources, filter), [movieSources, filter]);

  const meta: readonly SegmentPile<{ readonly title: string }>[] = isMovies
    ? moviePiles
    : showPiles;
  const matchCount = filtering ? meta.reduce((sum, pile) => sum + pile.shown.length, 0) : 0;

  const savedOpen: readonly string[] = isMovies ? openMovies : openPiles;
  // While filtering, the open set is derived from the matches (ephemeral) so it
  // never overwrites the saved layout; idle, it follows the saved state.
  const openValue: string[] = filtering
    ? meta.filter((pile) => pile.shown.length > 0).map((pile) => pile.key)
    : [...savedOpen];

  // Clearing must reset both the input and the debounced filter synchronously, or
  // the empty/expanded filter state lingers for the 300ms debounce window.
  const clearFilter = (): void => {
    setQuery("");
    setFilter("");
  };

  const onOpenChange = (values: string[]): void => {
    if (filtering) return; // the filter owns the open set; don't persist transient state
    if (isMovies) {
      const next = values.filter(isMovieSegment);
      setOpenMovies(next);
      persistOpen(MOVIE_OPEN_KEY, next);
    } else {
      const next = values.filter(isPileStatus);
      setOpenPiles(next);
      persistOpen(OPEN_KEY, next);
    }
  };

  const prefix = isMovies ? "movies" : "my-shows";
  const emptyCount = isMovies ? movieView.trackedCount : view.totalCount;
  const onlyAbandoned = !isMovies && view.trackedCount === 0 && view.totalCount > 0;

  const sortOptions: readonly string[] = isMovies ? MOVIE_SORTS : SORTS;
  const sortLabels: Record<string, string> = isMovies ? MOVIE_SORT_LABEL : SORT_LABEL;
  const sortValue = isMovies ? movieSort : showSort;
  const onSortChange = (value: string): void => {
    if (isMovies) setMovieSort(value as MovieSort);
    else setShowSort(value as LibrarySort);
  };

  let body: ReactNode;
  if (active.isLoading) {
    body = <LibrarySkeleton testId={`${prefix}-skeleton`} />;
  } else if (active.isError && !active.hasData) {
    body = (
      <div className="empty" data-testid={`${prefix}-error`}>
        <h2 className="empty__title">
          {isMovies ? "Couldn't load your movies" : "Couldn't load your library"}
        </h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid={`${prefix}-error-retry`}
          onClick={active.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (emptyCount === 0) {
    body = (
      <div className="empty" data-testid={`${prefix}-empty`}>
        <h2 className="empty__title">{isMovies ? "No movies yet" : "Nothing tracked yet"}</h2>
        <p className="empty__body">
          {isMovies
            ? "Mark a movie watched or add one to your watchlist and it'll show up here."
            : "Follow a show and mark an episode watched — it'll show up here, sorted by where you are."}
        </p>
      </div>
    );
  } else if (filtering && matchCount === 0) {
    body = (
      <div className="empty" data-testid={`${prefix}-filter-empty`}>
        <h2 className="empty__title">
          No {isMovies ? "movies" : "shows"} match “{filter}”
        </h2>
        <p className="empty__body">
          Try a different title, or clear the filter to see every {isMovies ? "movie" : "show"}.
        </p>
        <button type="button" className="button button--ghost" onClick={clearFilter}>
          Clear filter
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {onlyAbandoned && (
          <p className="library-note" data-testid="my-shows-only-abandoned">
            Every show you follow is stopped. Resume one to bring it back into your library.
          </p>
        )}
        {isMovies ? (
          <SegmentAccordion
            piles={moviePiles}
            openValue={openValue}
            onOpenChange={onOpenChange}
            filtering={filtering}
            keyOf={(movie: MovieEntry) => movie.movieId}
            renderCell={(movie: MovieEntry) => (
              <MoviePosterCard entry={movie} tmdbConfig={movieView.tmdbConfig} />
            )}
          />
        ) : (
          <SegmentAccordion
            piles={showPiles}
            openValue={openValue}
            onOpenChange={onOpenChange}
            filtering={filtering}
            keyOf={(entry: LibraryEntry) => entry.showId}
            renderCell={(entry: LibraryEntry, pile) => {
              if (pile.status === "abandoned") {
                return (
                  <StoppedTile
                    entry={entry}
                    tmdbConfig={view.tmdbConfig}
                    onResume={() =>
                      void unhide.unhide(
                        entry.showId,
                        { trakt: entry.showId, tmdb: entry.tmdbId ?? undefined },
                        entry.title,
                      )
                    }
                  />
                );
              }
              if (pile.status === "caught-up") {
                return <CaughtUpTile entry={entry} tmdbConfig={view.tmdbConfig} />;
              }
              return <PosterCard entry={entry} tmdbConfig={view.tmdbConfig} />;
            }}
          />
        )}
      </>
    );
  }

  return (
    <section className="screen screen--library" data-testid="screen-library">
      <header className="screen__head">
        <h1 className="screen__title">Library</h1>
        <SyncStatusPill
          testId="my-shows-status"
          isFetching={active.isFetching}
          isError={active.isError}
        />
      </header>

      <div className="library-controls">
        <ToggleGroup.Root
          type="single"
          className="segmented"
          aria-label="Library type"
          value={isMovies ? "movies" : "shows"}
          onValueChange={(value) => {
            // The toggle is view-state, not a distinct page: replace (don't push) so
            // Back skips past it, while the search param it writes still lets Back
            // from a detail page restore whichever tab launched it. Shows carries no
            // param (the canonical default); only Movies pins ?type=movies.
            if (value === "shows" || value === "movies") {
              // Reset the cross-segment filter on the switch so "Filter movies…"
              // starts clean rather than carrying a show query into the movie library.
              clearFilter();
              void navigate({
                to: "/library",
                search: value === "movies" ? { type: "movies" } : {},
                replace: true,
              });
            }
          }}
        >
          <ToggleGroup.Item className="segmented__item" value="shows" data-testid="type-shows">
            Shows
          </ToggleGroup.Item>
          <ToggleGroup.Item className="segmented__item" value="movies" data-testid="type-movies">
            Movies
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        <div className="library-controls__tools">
          <input
            type="search"
            className="library-filter"
            placeholder={isMovies ? "Filter movies…" : "Filter shows…"}
            aria-label={
              isMovies ? "Filter movies across your library" : "Filter shows across your library"
            }
            data-testid="library-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="library-sort">
            <span className="library-sort__label">Sort</span>
            <select
              className="library-sort__select"
              data-testid="sort-select"
              value={sortValue}
              onChange={(event) => onSortChange(event.target.value)}
            >
              {sortOptions.map((option) => (
                <option key={option} value={option}>
                  {sortLabels[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filtering && matchCount > 0 && (
        <p className="library-filter__summary" role="status" data-testid="filter-summary">
          {matchCount} matching{" "}
          {matchCount === 1 ? (isMovies ? "movie" : "show") : isMovies ? "movies" : "shows"}
        </p>
      )}

      {active.isError && active.hasData && (
        <CachedRetryBanner
          testId="my-shows-cached-retry"
          buttonTestId="my-shows-cached-retry-button"
          message="Showing your last synced library — Trakt couldn't be reached."
          onRetry={active.refetch}
        />
      )}

      {body}

      {unhide.error !== null && (
        <Snackbar
          testId="resume-error"
          message={unhide.error}
          actionLabel="Dismiss"
          onAction={unhide.clearError}
          onDismiss={unhide.clearError}
        />
      )}
      {unhide.undoable !== null && (
        <Snackbar
          testId="resume-undo"
          message={
            unhide.undoable.kind === "hide"
              ? `Stopped watching ${unhide.undoable.title}.`
              : `Resumed ${unhide.undoable.title}.`
          }
          actionLabel="Undo"
          autoDismissMs={6000}
          onAction={() => void unhide.undo()}
          onDismiss={unhide.dismissUndo}
        />
      )}
    </section>
  );
}
