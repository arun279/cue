import { Search, X } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

interface HistorySearchProps {
  readonly value: string;
  onChange(value: string): void;
}

/**
 * The in-header title filter: a 44px search icon that expands to a 44px field
 * overlaying the header's title slot. Session-scoped by design — closing (or
 * leaving the screen) clears the query; a filter is a moment, not a mode.
 */
export function HistorySearch({ value, onChange }: HistorySearchProps): ReactElement {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = (): void => {
    onChange("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="hist-search-toggle"
        aria-label="Filter by title"
        data-testid="history-search-toggle"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="hist-search" data-testid="history-search">
      <input
        ref={inputRef}
        className="hist-search__input"
        type="search"
        placeholder="Filter by title…"
        aria-label="Filter by title"
        value={value}
        data-testid="history-search-field"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      />
      <button
        type="button"
        className="hist-search__close"
        aria-label="Close filter"
        data-testid="history-search-close"
        onClick={close}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
