import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import type { LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useHideShow } from "@ui/hooks/useHideShow";
import { useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { formatAirDate } from "@ui/screens/up-next/format";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion, ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { MoviesLibrary } from "./MoviesLibrary";
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

/** Watching opens on first visit; every other segment stays collapsed as a
 * labelled, counted header (recognition over recall) until the user reaches for it. */
const DEFAULT_OPEN: readonly WatchStatus[] = ["watching"];
const OPEN_KEY = "cue.piles-open";

/**
 * Reuse the Discover settle delay (300ms): below the ~1s that reads as sluggish,
 * above a fast typist's inter-keystroke gap, so a mid-word burst expands the piles
 * once rather than thrashing on every keystroke.
 */
const FILTER_DEBOUNCE_MS = 300;

function readOpen(): WatchStatus[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw === null) return [...DEFAULT_OPEN];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_OPEN];
    return parsed.filter(
      (v): v is WatchStatus => typeof v === "string" && Object.hasOwn(PILE_LABEL, v),
    );
  } catch {
    return [...DEFAULT_OPEN];
  }
}

interface PileView {
  readonly status: WatchStatus;
  /** Tiles to render — every entry when idle, only title matches while filtering. */
  readonly shown: readonly LibraryEntry[];
  readonly total: number;
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
 * Library — the full honest collection as derived-state segments. Followed shows
 * group into a collapsible Accordion (Watchlist / Watching / Caught up / Finished /
 * Stopped), each a disclosure header carrying a count badge over a poster shelf,
 * reusing the SeasonPanel chevron idiom and the shared PosterGrid. Open/closed state
 * persists to localStorage; a debounced cross-segment filter ephemerally expands
 * matching segments without disturbing that saved state. Stopping happens on Show
 * detail; each Stopped tile carries a Resume recovery action, and Caught-up tiles
 * note a known return date. A Shows⇄Movies toggle switches library type. Every
 * state is designed: skeleton, hard error, cached-error banner, empty library,
 * only-stopped library, and no-filter-match.
 */
export function Library(): ReactElement {
  const [sort, setSort] = useState<LibrarySort>("recently-watched");
  const [libraryType, setLibraryType] = useState<"shows" | "movies">("shows");
  const [openPiles, setOpenPiles] = useState<WatchStatus[]>(readOpen);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");

  const view = useLibraryBuckets(sort);
  const movieView = useMovieLibrary();
  const unhide = useHideShow();
  const active = libraryType === "movies" ? movieView : view;

  useEffect(() => {
    const timer = setTimeout(() => setFilter(query.trim().toLowerCase()), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = filter.length > 0;

  const piles = useMemo<PileView[]>(
    () =>
      view.buckets.map((bucket) => ({
        status: bucket.status,
        total: bucket.entries.length,
        shown: filtering
          ? bucket.entries.filter((entry) => entry.title.toLowerCase().includes(filter))
          : bucket.entries,
      })),
    [view.buckets, filtering, filter],
  );

  const matchCount = filtering ? piles.reduce((sum, pile) => sum + pile.shown.length, 0) : 0;

  // While filtering, the open set is derived from the matches (ephemeral) so it
  // never overwrites the saved cue.piles-open; idle, it follows the saved state.
  const openValue = filtering
    ? piles.filter((pile) => pile.shown.length > 0).map((pile) => pile.status)
    : openPiles;

  // Clearing must reset both the input and the debounced filter synchronously, or
  // the empty/expanded filter state lingers for the 300ms debounce window.
  const clearFilter = (): void => {
    setQuery("");
    setFilter("");
  };

  const onOpenChange = (values: string[]): void => {
    if (filtering) return; // the filter owns the open set; don't persist transient state
    const next = values.filter((v): v is WatchStatus => Object.hasOwn(PILE_LABEL, v));
    setOpenPiles(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // A private-mode storage failure just forgets the layout next visit — non-fatal.
    }
  };

  const onlyAbandoned = view.trackedCount === 0 && view.totalCount > 0;

  let body: ReactNode;
  if (libraryType === "movies") {
    body = <MoviesLibrary view={movieView} />;
  } else if (view.isLoading) {
    body = <LibrarySkeleton testId="my-shows-skeleton" />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="my-shows-error">
        <h2 className="empty__title">Couldn't load your library</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="my-shows-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.totalCount === 0) {
    body = (
      <div className="empty" data-testid="my-shows-empty">
        <h2 className="empty__title">Nothing tracked yet</h2>
        <p className="empty__body">
          Follow a show and mark an episode watched — it'll show up here, sorted by where you are.
        </p>
      </div>
    );
  } else if (filtering && matchCount === 0) {
    body = (
      <div className="empty" data-testid="my-shows-filter-empty">
        <h2 className="empty__title">No shows match “{filter}”</h2>
        <p className="empty__body">Try a different title, or clear the filter to see every show.</p>
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
        <Accordion.Root
          type="multiple"
          className="piles"
          value={openValue}
          onValueChange={onOpenChange}
        >
          {piles.map((pile) => (
            <Accordion.Item
              key={pile.status}
              className="pile"
              value={pile.status}
              data-status={pile.status}
            >
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
                  <span className="pile__name">{PILE_LABEL[pile.status]}</span>
                  <span className="pile__count library-heading__count" data-testid="pile-count">
                    {filtering ? `${pile.shown.length}/${pile.total}` : pile.total}
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="pile__content">
                <PosterGrid
                  entries={pile.shown}
                  keyOf={(entry: LibraryEntry) => entry.showId}
                  renderCell={(entry: LibraryEntry) => {
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
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
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
          value={libraryType}
          onValueChange={(value) => {
            if (value === "shows" || value === "movies") setLibraryType(value);
          }}
        >
          <ToggleGroup.Item className="segmented__item" value="shows" data-testid="type-shows">
            Shows
          </ToggleGroup.Item>
          <ToggleGroup.Item className="segmented__item" value="movies" data-testid="type-movies">
            Movies
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        {libraryType === "shows" && (
          <div className="library-controls__tools">
            <input
              type="search"
              className="library-filter"
              placeholder="Filter shows…"
              aria-label="Filter shows across your library"
              data-testid="library-filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="library-sort">
              <span className="library-sort__label">Sort</span>
              <select
                className="library-sort__select"
                data-testid="sort-select"
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySort)}
              >
                {SORTS.map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {libraryType === "shows" && filtering && matchCount > 0 && (
        <p className="library-filter__summary" role="status" data-testid="filter-summary">
          {matchCount} matching {matchCount === 1 ? "show" : "shows"}
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
