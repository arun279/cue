import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { PosterCard } from "./PosterCard";

interface PosterGridProps {
  readonly entries: readonly LibraryEntry[];
  readonly tmdbConfig: TmdbImageConfig | null;
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
 * A responsive, window-virtualized poster grid — one per My Shows status bucket
 * The grid fills the screen width (6–8 cols desktop, 2–3 mobile) so a
 * library never leaves a dead field, while row windowing keeps the DOM bounded
 * on the Capacitor WebView even when a single bucket holds hundreds of shows.
 * Uniform 2:3 tiles make every row a fixed height, so the virtualizer needs no
 * per-item measurement and the page scrolls (not a nested rail).
 */
export function PosterGrid({ entries, tmdbConfig }: PosterGridProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<GridMetrics>({
    cols: 2,
    rowHeight: MIN_COL * 1.5 + CARD_META + ROW_GAP,
    scrollMargin: 0,
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const measure = (): void => {
      const width = el.clientWidth;
      const cols = Math.max(2, Math.floor((width + GAP) / (MIN_COL + GAP)));
      const colWidth = (width - (cols - 1) * GAP) / cols;
      setMetrics({
        cols,
        rowHeight: Math.round(colWidth * 1.5) + CARD_META + ROW_GAP,
        scrollMargin: el.offsetTop,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

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
              <li key={entry.showId} className="poster-grid__cell">
                <PosterCard entry={entry} tmdbConfig={tmdbConfig} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
