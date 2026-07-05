import type { CalendarDay, CalendarRow as CalendarRowModel } from "@domain/calendar";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { CardListSkeleton } from "@ui/components/CardListSkeleton";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { VirtualList } from "@ui/components/VirtualList";
import { CALENDAR_WINDOWS, useCalendar } from "@ui/hooks/useCalendar";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useMemo } from "react";
import { CalendarRow } from "./CalendarRow";

type Row =
  | { readonly kind: "header"; readonly label: string; readonly count: number }
  | { readonly kind: "episode"; readonly row: CalendarRowModel };

function flatten(days: readonly CalendarDay[]): Row[] {
  const rows: Row[] = [];
  for (const day of days) {
    rows.push({ kind: "header", label: day.label, count: day.rows.length });
    for (const row of day.rows) rows.push({ kind: "episode", row });
  }
  return rows;
}

/**
 * Upcoming / Calendar. Episodes for the user's shows grouped by
 * local day, with a window control that widens the request and refetches. Every
 * state is designed: skeleton, hard-error retry, cached-error banner, the
 * empty-window state, and the grouped+virtualized list with a quick mark-watched
 * on aired rows.
 */
export function Upcoming(): ReactElement {
  const view = useCalendar();
  const rows = useMemo(() => flatten(view.days), [view.days]);
  const hasEpisodes = view.days.length > 0;

  let body: ReactNode;
  if (view.isLoading) {
    body = <CardListSkeleton testId="upcoming-skeleton" />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="upcoming-error">
        <h2 className="empty__title">Couldn't load your calendar</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="upcoming-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (!hasEpisodes) {
    body = (
      <div className="empty" data-testid="upcoming-empty">
        <h2 className="empty__title">Nothing airing in the next {view.windowDays} days</h2>
        <p className="empty__body">
          When the shows you follow schedule new episodes, they'll appear here. Widen the window to
          look further ahead.
        </p>
      </div>
    );
  } else {
    body = (
      <VirtualList
        items={rows}
        estimateSize={92}
        label="Upcoming episodes grouped by day"
        className="card-list card-list--calendar"
        renderItem={(row) =>
          row.kind === "header" ? (
            <h2 className="calendar-heading" data-testid="calendar-day-heading">
              {row.label}
              <span className="calendar-heading__count">{row.count}</span>
            </h2>
          ) : (
            <CalendarRow
              row={row.row}
              tmdbConfig={view.tmdbConfig}
              watched={view.isWatched(row.row.ids.trakt)}
              onMark={() => void view.markWatched(row.row)}
            />
          )
        }
      />
    );
  }

  return (
    <section className="screen screen--full" data-testid="screen-upcoming">
      <header className="screen__head">
        <h1 className="screen__title">Upcoming</h1>
        <SyncStatusPill
          testId="upcoming-status"
          isFetching={view.isFetching}
          isError={view.isError}
        />
      </header>

      <div className="library-controls">
        <ToggleGroup.Root
          type="single"
          className="segmented"
          aria-label="Calendar window"
          value={String(view.windowDays)}
          onValueChange={(value) => {
            if (value !== "") view.setWindowDays(Number(value));
          }}
        >
          {CALENDAR_WINDOWS.map((days) => (
            <ToggleGroup.Item
              key={days}
              className="segmented__item"
              value={String(days)}
              data-testid={`window-${days}`}
            >
              {days} days
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      {view.isError && view.hasData && (
        <CachedRetryBanner
          testId="upcoming-cached-retry"
          buttonTestId="upcoming-cached-retry-button"
          message="Showing your last synced calendar — Trakt couldn't be reached."
          onRetry={view.refetch}
        />
      )}

      {body}

      {view.markError !== null && (
        <Snackbar
          testId="calendar-mark-error"
          message={view.markError}
          actionLabel="Dismiss"
          onAction={view.clearMarkError}
          onDismiss={view.clearMarkError}
        />
      )}
    </section>
  );
}
