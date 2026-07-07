import type { TmdbImageConfig } from "@data/image-source";
import type { HistoryDay, HistoryEntry, HistoryGroup } from "@domain/history";
import { localTimeZone } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { useHistory } from "@ui/hooks/useHistory";
import { episodeCode } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion, ToggleGroup } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

const UNDO_MS = 6000;
const RESTORED_MS = 4000;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "tv", label: "TV" },
  { value: "movies", label: "Movies" },
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
      data-testid="diary-remove"
      aria-label={`Remove this play of ${what}`}
      onClick={() => onRemove(entry)}
    >
      Remove this play
    </button>
  );
}

/** One standalone play — a lone episode or a movie. Quiet, past-tense, no ✓ pill. */
function DiarySingle({
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
        data-testid="diary-row-link"
      >
        <DiaryBody entry={entry} />
      </Link>
    ) : (
      <Link {...episodeDetailLink(entry)} className="card__link" data-testid="diary-row-link">
        <DiaryBody entry={entry} />
      </Link>
    );
  return (
    <li className="card diary-card" data-testid="diary-row" data-type={entry.type}>
      <EntryPoster entry={entry} tmdbConfig={tmdbConfig} />
      {link}
      <div className="diary-card__trailing">
        <time className="diary-card__time" dateTime={entry.watchedAt}>
          {timeFmt.format(new Date(entry.watchedAt))}
        </time>
        <RemoveButton entry={entry} onRemove={onRemove} />
      </div>
    </li>
  );
}

function DiaryBody({ entry }: { readonly entry: HistoryEntry }): ReactElement {
  return (
    <div className="card__body">
      <h4 className="card__title">{entry.title}</h4>
      <p className="diary-card__meta" data-testid="diary-meta">
        {entryMeta(entry)}
      </p>
    </div>
  );
}

/** A collapsed same-show cluster: one card that expands to its individual plays. A
 * bulk mark (all plays one minute) is labelled "Logged together" and its child
 * rows hide the synthetic clock; a real binge shows each play's own time. */
function DiaryCluster({
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
    <li
      className="diary-cluster"
      data-testid="diary-cluster"
      data-logged-together={group.loggedTogether}
    >
      <Accordion.Root type="single" collapsible className="diary-cluster__root">
        <Accordion.Item value="entries" className="diary-cluster__item">
          <div className="card diary-card diary-cluster__head">
            <EntryPoster entry={head} tmdbConfig={tmdbConfig} />
            <Accordion.Header className="diary-cluster__header">
              <Accordion.Trigger
                className="diary-cluster__trigger"
                data-testid="diary-cluster-trigger"
              >
                <span className="card__body">
                  <span className="card__title">{head.title}</span>
                  <span className="diary-card__meta">{clusterSummary(group.entries)}</span>
                </span>
                <span className="diary-cluster__aside">
                  {group.loggedTogether && (
                    <span className="diary-card__together" data-testid="diary-logged-together">
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
                <li key={entry.historyId} className="diary-child" data-testid="diary-child">
                  <Link
                    {...episodeDetailLink(entry)}
                    className="diary-child__link"
                    data-testid="diary-row-link"
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
    </li>
  );
}

const SKELETON_DAYS = [0, 1];
const SKELETON_ROWS = [0, 1, 2];

function DiarySkeleton(): ReactElement {
  return (
    <div className="diary-days" aria-hidden="true" data-testid="diary-skeleton">
      {SKELETON_DAYS.map((day) => (
        <div key={day} className="diary-day">
          <span className="skeleton-line skeleton-line--title diary-day__label--skeleton" />
          <ul className="diary-groups">
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

/**
 * The Diary — Cue's past tense, the body of Profile. A
 * reverse-chronological watch log grouped by the viewer's local day (Today /
 * Yesterday / dated), each day carrying a quiet play-count rollup, with a
 * server-side type filter. Rows are calm and past-tense (no amber ✓) and each
 * offers an exact, reversible "Remove this play". Every state is designed:
 * skeleton day-blocks, a first-run empty state, an error with retry, and a "Load
 * earlier" footer that walks history one page at a time.
 */
export function Diary(): ReactElement {
  const view = useHistory();

  let body: ReactNode;
  if (view.isLoading) {
    body = <DiarySkeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="diary-error">
        <h3 className="empty__title">Couldn't load your history</h3>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="diary-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.isEmpty) {
    body = (
      <div className="empty" data-testid="diary-empty">
        <h3 className="empty__title">Nothing logged yet</h3>
        <p className="empty__body">
          Mark an episode or movie watched and it appears here — your reverse-chronological record.
        </p>
        <Link className="button" to="/search" data-testid="diary-empty-discover">
          Find something to watch
        </Link>
      </div>
    );
  } else {
    body = (
      <>
        <ol className="diary-days" data-testid="diary-days">
          {view.days.map((day) => (
            <li key={day.dayKey} className="diary-day">
              <h3 className="diary-day__label" data-testid="diary-day-heading">
                {day.label}
                <span className="diary-day__count" data-testid="diary-day-count">
                  {dayRollup(day)}
                </span>
              </h3>
              <ul className="diary-groups">
                {day.groups.map((group) =>
                  group.entries.length === 1 ? (
                    <DiarySingle
                      key={group.key}
                      entry={group.entries[0] as HistoryEntry}
                      tmdbConfig={view.tmdbConfig}
                      onRemove={(entry) => void view.removePlay(entry)}
                    />
                  ) : (
                    <DiaryCluster
                      key={group.key}
                      group={group}
                      tmdbConfig={view.tmdbConfig}
                      onRemove={(entry) => void view.removePlay(entry)}
                    />
                  ),
                )}
              </ul>
            </li>
          ))}
        </ol>
        {view.hasMore && (
          <div className="diary-more">
            <button
              type="button"
              className="button button--ghost"
              data-testid="diary-load-earlier"
              aria-busy={view.isLoadingMore || undefined}
              disabled={view.isLoadingMore}
              onClick={view.loadEarlier}
            >
              {view.isLoadingMore ? "Loading…" : "Load earlier"}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section className="diary" data-testid="profile-diary" aria-label="Watch history">
      <div className="diary__head">
        <h2 className="diary__title">Watch history</h2>
        <ToggleGroup.Root
          type="single"
          className="segmented"
          aria-label="History type"
          value={view.filter}
          onValueChange={(value) => {
            if (value !== "") view.setFilter(value as typeof view.filter);
          }}
        >
          {FILTERS.map((option) => (
            <ToggleGroup.Item
              key={option.value}
              className="segmented__item"
              value={option.value}
              data-testid={`diary-filter-${option.value}`}
            >
              {option.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      {body}

      {view.error !== null && (
        <Snackbar
          testId="diary-remove-error"
          message={view.error}
          actionLabel="Dismiss"
          onAction={view.clearError}
          onDismiss={view.clearError}
        />
      )}
      {view.error === null && view.toast?.kind === "removed" && (
        <Snackbar
          testId="diary-undo"
          message="Removed from history"
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void view.undo()}
          onDismiss={view.dismissToast}
        />
      )}
      {view.error === null && view.toast?.kind === "restored" && (
        <Snackbar
          testId="diary-restored"
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
