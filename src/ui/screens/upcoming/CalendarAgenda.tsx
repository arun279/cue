import { defaultRangeExtractor, type Range, useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgendaItem } from "./agenda";
import { CalendarRow } from "./CalendarRow";

/** Fixed item heights (pinned in CSS), so the virtualizer never measures. */
const HEADER_H = 40;
const ROW_H = 64;

/**
 * The agenda list: window-virtualized (a 4-week window can hold hundreds of
 * rows on the Capacitor WebView) with sticky day headers. The active header —
 * the last one at or above the viewport start — renders `position: sticky`
 * under the screen header while every other item stays absolutely positioned;
 * the range extractor keeps that header mounted even once its own row scrolls
 * out of range.
 */
export function CalendarAgenda({ items }: { readonly items: readonly AgendaItem[] }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The SyncStrip mounting above this list moves its top offset without any
  // resize of its own; every such change re-renders this tree, so remeasure on
  // each commit (the guarded set drops no-ops).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const next = Math.round(el.getBoundingClientRect().top + window.scrollY);
    setScrollMargin((prev) => (prev === next ? prev : next));
  });

  const stickyIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === "header" ? [index] : [])),
    [items],
  );
  const activeSticky = useRef(0);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.kind === "header" ? HEADER_H : ROW_H),
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => {
      const item = items[index];
      if (item === undefined) return index;
      return item.kind === "header" ? `day-${item.dayKey}` : `ep-${item.row.ids.trakt}`;
    },
    rangeExtractor: useCallback(
      (range: Range) => {
        activeSticky.current =
          [...stickyIndexes].reverse().find((index) => range.startIndex >= index) ?? 0;
        const withSticky = new Set([activeSticky.current, ...defaultRangeExtractor(range)]);
        return [...withSticky].sort((a, b) => a - b);
      },
      [stickyIndexes],
    ),
  });

  return (
    <div ref={containerRef} className="calendar-agenda" data-testid="calendar-list">
      <ul
        className="calendar-agenda__list"
        aria-label="Upcoming episodes grouped by day"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          const sticky = item.kind === "header" && virtualRow.index === activeSticky.current;
          return (
            <li
              key={virtualRow.key}
              className="calendar-agenda__item"
              data-testid="virtual-row"
              data-index={virtualRow.index}
              data-pos={sticky ? "sticky" : "absolute"}
              style={
                sticky
                  ? undefined
                  : { transform: `translateY(${virtualRow.start - scrollMargin}px)` }
              }
            >
              {item.kind === "header" ? (
                <h2 className="calendar-day" data-testid="calendar-day-heading">
                  {item.label}
                  <span className="calendar-day__count">· {item.count}</span>
                </h2>
              ) : (
                <CalendarRow row={item.row} offset={item.offset} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
