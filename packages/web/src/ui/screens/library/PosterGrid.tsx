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

/** Gutter between cells, both axes. */
const GAP = 8;
/** Phone floor: three columns exactly (115px posters at the reference width). */
const MIN_COLS = 3;
/** Widest a poster may grow before the grid adds a column, so desktop tiles
 * stay cover-art sized instead of stretching three cells across the window. */
const MAX_COL = 180;
/** The 1-line caption under a poster (12px title) plus its 4px gap. */
const CAPTION = 24;

interface GridMetrics {
  readonly cols: number;
  readonly rowHeight: number;
  readonly scrollMargin: number;
}

/**
 * The Library poster grid: window-virtualized 3-column (wider viewports add
 * columns) 2:3 tiles with 8px gutters. Row windowing keeps the DOM bounded on
 * the Capacitor WebView even when a chip holds hundreds of tiles, and uniform
 * tiles make every row a fixed height, so the virtualizer needs no per-item
 * measurement and the page scrolls (never a nested rail). The cell renderer is
 * injected so show and movie tiles share the identical windowing.
 */
export function PosterGrid<T>({ entries, keyOf, renderCell }: PosterGridProps<T>): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<GridMetrics>({
    cols: MIN_COLS,
    rowHeight: Math.round(120 * 1.5) + CAPTION + GAP,
    scrollMargin: 0,
  });
  const [metrics, setMetrics] = useState<GridMetrics>(metricsRef.current);

  const measure = useCallback((): void => {
    const el = containerRef.current;
    if (el === null) return;
    const width = el.clientWidth;
    const cols = Math.max(MIN_COLS, Math.ceil((width + GAP) / (MAX_COL + GAP)));
    const colWidth = (width - (cols - 1) * GAP) / cols;
    // getBoundingClientRect is page-relative regardless of positioned ancestors,
    // so the grid knows where the window scroll starts even as the controls,
    // chips, or SyncStrip above it change height.
    const next: GridMetrics = {
      cols,
      rowHeight: Math.round(colWidth * 1.5) + CAPTION + GAP,
      scrollMargin: Math.round(el.getBoundingClientRect().top + window.scrollY),
    };
    if (sameMetrics(metricsRef.current, next)) return;
    metricsRef.current = next;
    setMetrics(next);
  }, []);

  // Anything toggling ABOVE this grid (filter field, sync strip) moves its top
  // offset without changing its own size, so a ResizeObserver can't catch it:
  // but every such change re-renders this tree, so remeasure on each commit;
  // sameMetrics drops no-op sets.
  useLayoutEffect(() => {
    measure();
  });

  // This grid's own width changing (viewport resize / orientation) doesn't
  // re-render it, so a ResizeObserver keeps the column math and row height live.
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
      className="library-grid"
      data-testid="virtual-list"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * cols;
        return (
          <ul
            key={row.key}
            className="library-grid__row"
            data-testid="virtual-row"
            data-index={row.index}
            style={{
              transform: `translateY(${row.start - scrollMargin}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {entries.slice(start, start + cols).map((entry) => (
              <li key={keyOf(entry)} className="library-grid__cell">
                {renderCell(entry)}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
