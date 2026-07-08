import type { TmdbImageConfig } from "@data/image-source";
import type { HistoryDay, HistoryEntry, HistoryGroup } from "@domain/history";
import { localTimeZone } from "@domain/time";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DetailBack } from "@ui/components/DetailBack";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { VirtualList } from "@ui/components/VirtualList";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type HistoryFilter, type HistoryScope, useHistory } from "@ui/hooks/useHistory";
import { usePrefs } from "@ui/prefs/prefs-store";
import { episodeCode } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion, ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useMemo } from "react";

const UNDO_MS = 6000;
const RESTORED_MS = 4000;

/** The card row estimate (px) for the virtualizer's first paint; real heights are
 * measured after mount, so this only shapes initial overscan. Matches the Calendar
 * row card, which shares the same poster + two-line body dimensions. */
const ROW_ESTIMATE = 92;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "tv", label: "TV" },
  { value: "movies", label: "Movies" },
] as const;

/**
 * The decade-jump floor for the Year picker: no year older than this is offered as
 * a chip. Cue's only backend is Trakt, and a large Trakt migration (the app's
 * origin story) carries plays no earlier than the early-2010s tracking era; 2010
 * sits comfortably before that, so the picker spans every realistic year without an
 * endless list of empty ones. A deep link (`?year=2004`) still reaches any older
 * year the picker doesn't list, so this floor never hides real history. */
const HISTORY_EPOCH_YEAR = 2010;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The quiet per-day rollup, e.g. "3 episodes · 1 movie". */
function dayRollup(day: HistoryDay): string {
  const parts: string[] = [];
  if (day.episodeCount > 0) parts.push(plural(day.episodeCount, "episode"));
  if (day.movieCount > 0) parts.push(plural(day.movieCount, "movie"));
  return parts.join(" · ");
}

/** The played thing's secondary line: SxEy · title for an episode, release year for a movie. */
function entryMeta(entry: HistoryEntry): string {
  if (entry.type === "movie") return entry.year === null ? "Movie" : String(entry.year);
  const code = episodeCode(entry.season ?? 0, entry.number ?? 0);
  return entry.episodeTitle === null ? code : `${code} · ${entry.episodeTitle}`;
}

/** A collapsed same-show cluster header, e.g. "S1 E5–E8 · 4 episodes". */
function clusterSummary(entries: readonly HistoryEntry[]): string {
  const count = plural(entries.length, "episode");
  const seasons = new Set(entries.map((e) => e.season));
  if (seasons.size !== 1) return count;
  const season = entries[0]?.season ?? 0;
  const numbers = entries.map((e) => e.number ?? 0);
  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);
  const range = lo === hi ? `E${lo}` : `E${lo}–E${hi}`;
  return `S${season} ${range} · ${count}`;
}

/** The human scope label for headings/empty states: "2019" or "March 2019". */
function scopeLabel(year: number | undefined, month: number | undefined): string | null {
  if (year === undefined) return null;
  if (month === undefined) return String(year);
  return `${MONTHS[month - 1]} ${year}`;
}

function episodeDetailLink(entry: HistoryEntry): {
  readonly to: "/show/$showId/episode/$season/$episode";
  readonly params: { readonly showId: string; readonly season: string; readonly episode: string };
} {
  return {
    to: "/show/$showId/episode/$season/$episode",
    params: {
      showId: String(entry.mediaId),
      season: String(entry.season ?? 0),
      episode: String(entry.number ?? 0),
    },
  };
}

function EntryPoster({
  entry,
  tmdbConfig,
}: {
  readonly entry: HistoryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
}): ReactElement {
  return <Poster title={entry.title} posters={entry.posters} tmdbConfig={tmdbConfig} />;
}

function RemoveButton({
  entry,
  onRemove,
}: {
  readonly entry: HistoryEntry;
  onRemove(entry: HistoryEntry): void;
}): ReactElement {
  const what = entry.type === "movie" ? entry.title : `${entry.title} ${entryMeta(entry)}`;
  return (
    <button
      type="button"
      className="diary-remove"
      data-testid="history-remove"
      aria-label={`Remove this play of ${what}`}
      onClick={() => onRemove(entry)}
    >
      Remove this play
    </button>
  );
}

function EntryBody({ entry }: { readonly entry: HistoryEntry }): ReactElement {
  return (
    <div className="card__body">
      <h4 className="card__title">{entry.title}</h4>
      <p className="diary-card__meta" data-testid="history-meta">
        {entryMeta(entry)}
      </p>
    </div>
  );
}

/** One standalone play — a lone episode or a movie. Quiet, past-tense, no ✓ pill. */
function HistorySingle({
  entry,
  tmdbConfig,
  onRemove,
}: {
  readonly entry: HistoryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
  onRemove(entry: HistoryEntry): void;
}): ReactElement {
  const link: ReactNode =
    entry.type === "movie" ? (
      <Link
        to="/movie/$movieId"
        params={{ movieId: String(entry.mediaId) }}
        className="card__link"
        data-testid="history-row-link"
      >
        <EntryBody entry={entry} />
      </Link>
    ) : (
      <Link {...episodeDetailLink(entry)} className="card__link" data-testid="history-row-link">
        <EntryBody entry={entry} />
      </Link>
    );
  return (
    <div className="card diary-card" data-testid="history-row" data-type={entry.type}>
      <EntryPoster entry={entry} tmdbConfig={tmdbConfig} />
      {link}
      <div className="diary-card__trailing">
        <time className="diary-card__time" dateTime={entry.watchedAt}>
          {timeFmt.format(new Date(entry.watchedAt))}
        </time>
        <RemoveButton entry={entry} onRemove={onRemove} />
      </div>
    </div>
  );
}

/** A collapsed same-show cluster: one card that expands to its individual plays. A
 * bulk mark (all plays one minute) is labelled "Logged together" and its child
 * rows hide the synthetic clock; a real binge shows each play's own time. */
function HistoryCluster({
  group,
  tmdbConfig,
  onRemove,
}: {
  readonly group: HistoryGroup;
  readonly tmdbConfig: TmdbImageConfig | null;
  onRemove(entry: HistoryEntry): void;
}): ReactElement {
  const head = group.entries[0] as HistoryEntry;
  return (
    <div
      className="diary-cluster"
      data-testid="history-cluster"
      data-logged-together={group.loggedTogether}
    >
      <Accordion.Root type="single" collapsible className="diary-cluster__root">
        <Accordion.Item value="entries" className="diary-cluster__item">
          <div className="card diary-card diary-cluster__head">
            <EntryPoster entry={head} tmdbConfig={tmdbConfig} />
            <Accordion.Header className="diary-cluster__header">
              <Accordion.Trigger
                className="diary-cluster__trigger"
                data-testid="history-cluster-trigger"
              >
                <span className="card__body">
                  <span className="card__title">{head.title}</span>
                  <span className="diary-card__meta">{clusterSummary(group.entries)}</span>
                </span>
                <span className="diary-cluster__aside">
                  {group.loggedTogether && (
                    <span className="diary-card__together" data-testid="history-logged-together">
                      Logged together
                    </span>
                  )}
                  <svg
                    className="diary-cluster__chevron"
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
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
          </div>
          <Accordion.Content className="diary-cluster__content">
            <ul className="diary-cluster__list">
              {group.entries.map((entry) => (
                <li key={entry.historyId} className="diary-child" data-testid="history-child">
                  <Link
                    {...episodeDetailLink(entry)}
                    className="diary-child__link"
                    data-testid="history-row-link"
                  >
                    <span className="diary-child__code">
                      {episodeCode(entry.season ?? 0, entry.number ?? 0)}
                    </span>
                    {entry.episodeTitle !== null && (
                      <span className="diary-child__title">{entry.episodeTitle}</span>
                    )}
                  </Link>
                  <div className="diary-card__trailing">
                    {!group.loggedTogether && (
                      <time className="diary-card__time" dateTime={entry.watchedAt}>
                        {timeFmt.format(new Date(entry.watchedAt))}
                      </time>
                    )}
                    <RemoveButton entry={entry} onRemove={onRemove} />
                  </div>
                </li>
              ))}
            </ul>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </div>
  );
}

const SKELETON_DAYS = [0, 1];
const SKELETON_ROWS = [0, 1, 2];

function HistorySkeleton(): ReactElement {
  return (
    <div className="history-scroll" aria-hidden="true" data-testid="history-skeleton">
      {SKELETON_DAYS.map((day) => (
        <div key={day} className="history-skeleton-day">
          <span className="skeleton-line skeleton-line--title diary-day__label--skeleton" />
          <ul className="history-skeleton-groups">
            {SKELETON_ROWS.map((row) => (
              <li key={row} className="card diary-card diary-card--skeleton">
                <span className="poster poster--row diary-card__poster--skeleton" />
                <span className="skeleton-line skeleton-line--sub" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The flattened, virtualizer-friendly row stream: a day heading, then its plays
 * (single or collapsed cluster), then an optional "Load earlier" sentinel. */
type Row =
  | { readonly kind: "day"; readonly day: HistoryDay }
  | { readonly kind: "single"; readonly group: HistoryGroup }
  | { readonly kind: "cluster"; readonly group: HistoryGroup }
  | { readonly kind: "more" };

function flatten(days: readonly HistoryDay[], hasMore: boolean): Row[] {
  const rows: Row[] = [];
  for (const day of days) {
    rows.push({ kind: "day", day });
    for (const group of day.groups) {
      rows.push(
        group.entries.length === 1 ? { kind: "single", group } : { kind: "cluster", group },
      );
    }
  }
  if (hasMore) rows.push({ kind: "more" });
  return rows;
}

const YEAR_RECENT = "";

/**
 * Watch history at scale. Cue's past tense on its own route: a
 * reverse-chronological, virtualized watch log grouped by the viewer's local day,
 * with a type filter and a decade jump (Year → Month) so a ten-thousand-play,
 * decade-deep account can teleport to any window instead of scrolling forever.
 * Rows stay calm and past-tense (no amber ✓) and each offers an exact, reversible
 * "Remove this play". Every state is designed: skeleton, hard error with retry, a
 * scope-aware empty state, and a "Load earlier" sentinel that walks the window one
 * page at a time. Reached from the Profile hub; Back returns there.
 */
export function History(): ReactElement {
  useDocumentTitle("Watch history · Cue");
  const { type, year, month } = useSearch({ from: "/history" });
  const navigate = useNavigate();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);

  // A single-medium user is pinned to their medium and shown no toggle —
  // the same "one active medium shows no toggle" idiom as the Library.
  const lockedFilter: HistoryFilter | undefined = !moviesEnabled
    ? "tv"
    : !showsEnabled
      ? "movies"
      : undefined;
  const filter: HistoryFilter = lockedFilter ?? type ?? "all";
  const scope: HistoryScope = { filter, year, month };
  const view = useHistory(scope);

  const rows = useMemo(() => flatten(view.days, view.hasMore), [view.days, view.hasMore]);
  const label = scopeLabel(year, month);

  const setFilter = (value: HistoryFilter): void => {
    void navigate({
      to: "/history",
      search: (prev) => ({ ...prev, type: value === "all" ? undefined : value }),
      replace: true,
    });
  };

  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= HISTORY_EPOCH_YEAR; y -= 1) years.push(y);
  // A deep-linked year older than the epoch floor still gets its own option so the
  // control reflects the real scope rather than silently snapping to "Recent".
  if (year !== undefined && !years.includes(year)) years.push(year);

  const onYear = (value: string): void => {
    void navigate({
      to: "/history",
      // Switching year clears any month drill (a month is meaningless without it).
      search: (prev) => ({
        ...prev,
        year: value === YEAR_RECENT ? undefined : Number(value),
        month: undefined,
      }),
    });
  };
  const onMonth = (value: string): void => {
    void navigate({
      to: "/history",
      search: (prev) => ({ ...prev, month: value === "" ? undefined : Number(value) }),
    });
  };

  let body: ReactNode;
  if (view.isLoading) {
    body = <HistorySkeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="history-error">
        <h2 className="empty__title">Couldn't load your history</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="history-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.isEmpty) {
    body =
      label === null ? (
        <div className="empty" data-testid="history-empty">
          <h2 className="empty__title">Nothing logged yet</h2>
          <p className="empty__body">
            Mark an episode or movie watched and it appears here — your reverse-chronological
            record.
          </p>
          <Link className="button" to="/search" data-testid="history-empty-discover">
            Find something to watch
          </Link>
        </div>
      ) : (
        <div className="empty" data-testid="history-empty">
          <h2 className="empty__title">Nothing watched in {label}</h2>
          <p className="empty__body">
            No plays fall in this window. Pick another month or year, or return to your recent
            history.
          </p>
          <button
            type="button"
            className="button"
            data-testid="history-empty-recent"
            onClick={() => onYear(YEAR_RECENT)}
          >
            Back to recent
          </button>
        </div>
      );
  } else {
    body = (
      <VirtualList
        items={rows}
        estimateSize={ROW_ESTIMATE}
        label={`Watch history${label === null ? "" : ` for ${label}`}, grouped by day`}
        className="history-scroll"
        renderItem={(row) => {
          if (row.kind === "day") {
            return (
              <h3 className="history-heading" data-testid="history-day-heading">
                {row.day.label}
                <span className="history-heading__count" data-testid="history-day-count">
                  {dayRollup(row.day)}
                </span>
              </h3>
            );
          }
          if (row.kind === "single") {
            return (
              <HistorySingle
                entry={row.group.entries[0] as HistoryEntry}
                tmdbConfig={view.tmdbConfig}
                onRemove={(entry) => void view.removePlay(entry)}
              />
            );
          }
          if (row.kind === "cluster") {
            return (
              <HistoryCluster
                group={row.group}
                tmdbConfig={view.tmdbConfig}
                onRemove={(entry) => void view.removePlay(entry)}
              />
            );
          }
          return (
            <div className="history-more">
              {view.isLoadMoreError && !view.isLoadingMore && (
                <p
                  className="diary-more__error"
                  role="alert"
                  data-testid="history-load-earlier-error"
                >
                  Couldn't load earlier history.
                </p>
              )}
              <button
                type="button"
                className="button button--ghost"
                data-testid="history-load-earlier"
                aria-busy={view.isLoadingMore || undefined}
                disabled={view.isLoadingMore}
                onClick={view.loadEarlier}
              >
                {view.isLoadingMore ? "Loading…" : view.isLoadMoreError ? "Retry" : "Load earlier"}
              </button>
            </div>
          );
        }}
      />
    );
  }

  return (
    <section className="screen screen--full screen--history" data-testid="screen-history">
      <header className="screen__head screen__head--stack">
        <div className="screen__headline">
          <DetailBack
            testId="history-back"
            label="‹ Back"
            fallback={
              <Link className="detail-back" to="/profile" data-testid="history-back">
                ‹ Profile
              </Link>
            }
          />
          <h1 className="screen__title">Watch history</h1>
        </div>
        <SyncStatusPill
          testId="history-status"
          isFetching={view.isFetching}
          isError={view.isError}
          syncedAt={view.syncedAt}
        />
      </header>

      {/* TODO(history-search): the decade jump (Year/Month) covers "find what I
          watched around <time>"; a title-scoped filter ("an episode of Show X years
          ago") would round out findability. Deferred deliberately — it needs a
          title picker over `/search` routing to an item-scoped `/users/me/history`
          read, out of scope for this pass. */}
      <div className="library-controls history-controls">
        {lockedFilter === undefined && (
          <ToggleGroup.Root
            type="single"
            className="segmented"
            aria-label="History type"
            value={filter}
            onValueChange={(value) => {
              if (value !== "") setFilter(value as HistoryFilter);
            }}
          >
            {FILTERS.map((option) => (
              <ToggleGroup.Item
                key={option.value}
                className="segmented__item"
                value={option.value}
                data-testid={`history-filter-${option.value}`}
              >
                {option.label}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        )}

        <div className="history-jump">
          <label className="history-jump__field">
            <span className="history-jump__label">Year</span>
            <select
              className="history-select"
              data-testid="history-year"
              value={year === undefined ? YEAR_RECENT : String(year)}
              onChange={(e) => onYear(e.target.value)}
            >
              <option value={YEAR_RECENT}>Recent</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          {year !== undefined && (
            <label className="history-jump__field">
              <span className="history-jump__label">Month</span>
              <select
                className="history-select"
                data-testid="history-month"
                value={month === undefined ? "" : String(month)}
                onChange={(e) => onMonth(e.target.value)}
              >
                <option value="">All of {year}</option>
                {MONTHS.map((name, i) => (
                  <option key={name} value={String(i + 1)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {body}

      {view.error !== null && (
        <Snackbar
          testId="history-remove-error"
          message={view.error}
          actionLabel="Dismiss"
          onAction={view.clearError}
          onDismiss={view.clearError}
        />
      )}
      {view.error === null && view.toast?.kind === "removed" && (
        <Snackbar
          testId="history-undo"
          message="Removed from history"
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void view.undo()}
          onDismiss={view.dismissToast}
        />
      )}
      {view.error === null && view.toast?.kind === "restored" && (
        <Snackbar
          testId="history-restored"
          message="Restored to history"
          actionLabel="Dismiss"
          autoDismissMs={RESTORED_MS}
          onAction={view.dismissToast}
          onDismiss={view.dismissToast}
        />
      )}
    </section>
  );
}
