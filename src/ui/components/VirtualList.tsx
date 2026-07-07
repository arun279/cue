import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, type ReactNode, useRef } from "react";

interface VirtualListProps<T> {
  items: readonly T[];
  /** Row height estimate in px; the virtualizer measures real rows after mount. */
  estimateSize: number;
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  label: string;
  className?: string;
}

/**
 * Reusable windowed list so the calendar (its only consumer)
 * keeps DOM node count bounded on the Capacitor WebView. Only the visible slice
 * (+overscan) is mounted regardless of `items.length`.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 6,
  renderItem,
  label,
  className,
}: VirtualListProps<T>): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div
      ref={scrollRef}
      className={className}
      data-testid="virtual-list"
      style={{ overflowY: "auto" }}
    >
      <ul
        aria-label={label}
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          return (
            <li
              key={row.key}
              data-testid="virtual-row"
              ref={virtualizer.measureElement}
              data-index={row.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            >
              {renderItem(item, row.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
