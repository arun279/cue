import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { CALENDAR_WINDOW_DAYS, useCalendar } from "@ui/hooks/useCalendar";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type ReactElement, type ReactNode, useMemo } from "react";
import { buildAgenda } from "./agenda";
import { CalendarAgenda } from "./CalendarAgenda";

const SKELETON_ROWS = [0, 1, 2, 3];

function CalendarSkeleton(): ReactElement {
  return (
    <div className="calendar-skeleton" aria-hidden="true" data-testid="upcoming-skeleton">
      <div className="calendar-skeleton__day" />
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="calendar-skeleton__row">
          <div className="calendar-skeleton__poster" />
          <div className="calendar-skeleton__body">
            <div className="calendar-skeleton__bar calendar-skeleton__bar--title" />
            <div className="calendar-skeleton__bar calendar-skeleton__bar--meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Calendar: the forward-looking agenda of the user's shows, ~4 weeks deep,
 * grouped under sticky day headers. Read-only by design: aired-unwatched
 * episodes already live in the Up Next queue, so this screen never offers a
 * second place to mark. Error keeps the cached agenda under the SyncStrip; a
 * truly empty window is honest news, not a failure.
 */
export function Upcoming(): ReactElement {
  useDocumentTitle("Calendar · Cue");
  const view = useCalendar(CALENDAR_WINDOW_DAYS);
  const items = useMemo(() => buildAgenda(view.days, view.now), [view.days, view.now]);

  let body: ReactNode;
  if (view.isLoading) {
    body = <CalendarSkeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <ErrorRetry
        title="Couldn't load your calendar"
        testId="upcoming-error"
        buttonTestId="upcoming-error-retry"
        onRetry={view.refetch}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        testId="upcoming-empty"
        headline="No upcoming episodes. Your shows are between seasons."
      />
    );
  } else {
    body = <CalendarAgenda items={items} />;
  }

  return (
    <section className="screen-calendar" data-testid="screen-calendar">
      <ScreenHeader title="Calendar" variant="root" />
      <SyncStrip isError={view.isError} onRetry={view.refetch} />
      {body}
    </section>
  );
}
