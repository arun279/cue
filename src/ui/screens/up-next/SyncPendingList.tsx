import type { LibraryEntry } from "@data/trakt/library";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { SyncPendingRow } from "./SyncPendingRow";

const ROW_HEIGHT = 72;
const ROW_GAP = 4;

interface ListLayout {
  readonly ready: boolean;
  readonly scrollMargin: number;
}

/** Windowed budget-tail rows, with network reads enabled only for the visible range. */
export function SyncPendingList({
  entries,
}: {
  readonly entries: readonly LibraryEntry[];
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ListLayout>({ ready: false, scrollMargin: 0 });

  // Every row that resolves leaves this list for the queue above it, moving this
  // list's top offset without any resize of its own; each such change re-renders
  // this tree, so remeasure on each commit (the guarded set drops no-ops).
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const scrollMargin = Math.round(element.getBoundingClientRect().top + window.scrollY);
    setLayout((current) =>
      current.ready && current.scrollMargin === scrollMargin
        ? current
        : { ready: true, scrollMargin },
    );
  });

  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: () => ROW_HEIGHT,
    gap: ROW_GAP,
    overscan: 3,
    scrollMargin: layout.scrollMargin,
  });
  const viewportStart = virtualizer.scrollOffset;
  const viewportHeight = virtualizer.scrollRect?.height;

  return (
    <div ref={containerRef} className="sync-pending">
      <ul
        className="sync-pending__list"
        data-testid="sync-pending-list"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          if (entry === undefined) return null;
          const visible =
            layout.ready &&
            viewportStart !== null &&
            viewportHeight !== undefined &&
            virtualRow.end > viewportStart &&
            virtualRow.start < viewportStart + viewportHeight;
          return (
            <li
              key={entry.showId}
              className="sync-pending__item"
              style={{ transform: `translateY(${virtualRow.start - layout.scrollMargin}px)` }}
            >
              <SyncPendingRow entry={entry} visible={visible} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
