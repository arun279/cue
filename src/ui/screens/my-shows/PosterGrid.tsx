import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

function sameMetrics(a: GridMetrics, b: GridMetrics): boolean {
  return a.cols === b.cols && a.rowHeight === b.rowHeight && a.scrollMargin === b.scrollMargin;
}

interface PosterGridProps<T> {
  readonly entries: readonly T[];
  keyOf(entry: T): string | number;
  renderCell(entry: T): ReactNode;
}

/** Smallest tile the grid ever draws; below it a 2:3 poster stops reading as
 * cover art. Drives the column count: ~5 columns of ~178px posters at the
 * desktop content width, 2-up on a 390px phone — near the grid target,
 * sized so tiles read as curated cover art and stay identical across buckets. */
const MIN_COL = 150;
/** Column gutter = the established shelf gap (`--space-3`). */
const GAP = 12;
/** Vertical rhythm between poster rows (`--space-5`) — tighter than the 32px
 * section gap so a shelf reads as one block, looser than the column gutter. */
const ROW_GAP = 24;
/** Title + ratio meta block beneath a poster, plus the poster→meta gap
 * (`--space-2`). A hair over the measured height so a row never crowds the next. */
const CARD_META = 48;

interface GridMetrics {
  readonly cols: number;
  readonly rowHeight: number;
  readonly scrollMargin: number;
}

/**
 * A responsive, window-virtualized poster grid — one per My Shows shelf,
 * shared by the show buckets and the movie shelves. The grid fills the screen
 * width (6–8 cols desktop, 2–3 mobile) so a library never leaves a dead field,
 * while row windowing keeps the DOM bounded on the Capacitor WebView even when a
 * single shelf holds hundreds of tiles. Uniform 2:3 tiles make every row a fixed
 * height, so the virtualizer needs no per-item measurement and the page scrolls
 * (not a nested rail). The cell renderer is injected so a show or movie tile
 * shares this identical windowing.
 */
export function PosterGrid<T>({ entries, keyOf, renderCell }: PosterGridProps<T>): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<GridMetrics>({
    cols: 2,
    rowHeight: MIN_COL * 1.5 + CARD_META + ROW_GAP,
    scrollMargin: 0,
  });
  const [metrics, setMetrics] = useState<GridMetrics>(metricsRef.current);

  const measure = useCallback((): void => {
    const el = containerRef.current;
    if (el === null) return;
    const width = el.clientWidth;
    const cols = Math.max(2, Math.floor((width + GAP) / (MIN_COL + GAP)));
    const colWidth = (width - (cols - 1) * GAP) / cols;
    // getBoundingClientRect is page-relative regardless of positioned ancestors, so
    // a grid nested in a collapsible pile still knows where the window scroll starts.
    const next: GridMetrics = {
      cols,
      rowHeight: Math.round(colWidth * 1.5) + CARD_META + ROW_GAP,
      scrollMargin: Math.round(el.getBoundingClientRect().top + window.scrollY),
    };
    if (sameMetrics(metricsRef.current, next)) return;
    metricsRef.current = next;
    setMetrics(next);
  }, []);

  // A pile toggling/filtering ABOVE this grid moves its top offset without changing
  // its own size, so a ResizeObserver can't catch it — but every such change
  // re-renders this tree, so remeasure on each commit; sameMetrics drops no-op sets.
  useLayoutEffect(() => {
    measure();
  });

  // This grid's own width changing (viewport resize / orientation) doesn't re-render
  // it, so a ResizeObserver keeps the column math and row height live.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const { cols, rowHeight, scrollMargin } = metrics;
  const rowCount = Math.ceil(entries.length / cols);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  return (
    <div
      ref={containerRef}
      className="poster-grid"
      data-testid="virtual-list"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * cols;
        return (
          <ul
            key={row.key}
            className="poster-grid__row"
            data-testid="virtual-row"
            data-index={row.index}
            style={{
              transform: `translateY(${row.start - scrollMargin}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {entries.slice(start, start + cols).map((entry) => (
              <li key={keyOf(entry)} className="poster-grid__cell">
                {renderCell(entry)}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
