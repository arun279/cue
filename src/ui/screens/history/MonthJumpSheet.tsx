import { Sheet } from "@ui/components/Sheet";
import { type ReactElement, useEffect, useState } from "react";

/**
 * The decade-jump floor for the year grid: no year older than this is offered as
 * a button. Cue's only backend is Trakt, and a large Trakt migration (the app's
 * origin story) carries plays no earlier than the early-2010s tracking era; 2010
 * sits comfortably before that, so the grid spans every realistic year without an
 * endless list of empty ones. A deep link (`?year=2004`) still reaches any older
 * year the grid doesn't list, so this floor never hides real history.
 */
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

export interface HistoryJumpScope {
  readonly year?: number;
  readonly month?: number;
}

interface MonthJumpSheetProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  readonly year?: number;
  readonly month?: number;
  onPick(scope: HistoryJumpScope): void;
}

/**
 * The month/year jump sheet behind the History month chip: pick a year, then a
 * month within it (or the whole year), or drop back to the recent feed. Every
 * pick maps straight onto the `?year`/`?month` params, so a jump is always a
 * deep-linkable URL, never private screen state.
 */
export function MonthJumpSheet({
  open,
  onOpenChange,
  year,
  month,
  onPick,
}: MonthJumpSheetProps): ReactElement {
  const [pickedYear, setPickedYear] = useState<number | undefined>(year);

  // Fresh presentation per open: start from the scope the URL currently holds.
  useEffect(() => {
    if (open) setPickedYear(year);
  }, [open, year]);

  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= HISTORY_EPOCH_YEAR; y -= 1) years.push(y);
  // A deep-linked year older than the epoch floor still gets its own button so
  // the sheet reflects the real scope rather than silently snapping to "Recent".
  if (year !== undefined && !years.includes(year)) years.push(year);

  const pick = (scope: HistoryJumpScope): void => {
    onPick(scope);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="hist-jump" data-testid="history-jump-sheet">
        <h2 className="sheet-menu__title">Jump to</h2>
        {pickedYear === undefined ? (
          <>
            <button
              type="button"
              className="sheet-menu__row"
              data-testid="history-jump-recent"
              onClick={() => pick({})}
            >
              Recent
            </button>
            <fieldset className="hist-jump__grid">
              <legend className="sr-only">Year</legend>
              {years.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="hist-jump__cell"
                  aria-pressed={option === year}
                  data-selected={option === year || undefined}
                  data-testid={`history-jump-year-${option}`}
                  onClick={() => setPickedYear(option)}
                >
                  {option}
                </button>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <button
              type="button"
              className="sheet-menu__row"
              data-testid="history-jump-back"
              onClick={() => setPickedYear(undefined)}
            >
              ‹ All years
            </button>
            <button
              type="button"
              className="sheet-menu__row"
              data-testid="history-jump-all"
              onClick={() => pick({ year: pickedYear })}
            >
              All of {pickedYear}
            </button>
            <fieldset className="hist-jump__grid">
              <legend className="sr-only">Month of {pickedYear}</legend>
              {MONTHS.map((name, index) => {
                const value = index + 1;
                const selected = pickedYear === year && value === month;
                return (
                  <button
                    key={name}
                    type="button"
                    className="hist-jump__cell"
                    aria-pressed={selected}
                    data-selected={selected || undefined}
                    data-testid={`history-jump-month-${value}`}
                    onClick={() => pick({ year: pickedYear, month: value })}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </fieldset>
          </>
        )}
      </div>
    </Sheet>
  );
}
