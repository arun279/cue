import { Search as SearchIcon, X } from "lucide-react";
import type { ReactElement } from "react";

interface SearchFieldProps {
  readonly value: string;
  onChange(value: string): void;
  readonly placeholder: string;
  /** Accessible name for the input (the visual field has no label text). */
  readonly label: string;
}

/**
 * The Search screen's query field: 48px elevated bar with a leading magnifier
 * and a trailing clear button once filled. Deliberately never auto-focused;
 * focus comes from a tap, so the keyboard never pops uninvited.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: SearchFieldProps): ReactElement {
  return (
    <div className="search-field">
      <SearchIcon className="search-field__icon" aria-hidden="true" />
      <input
        type="search"
        className="search-field__input"
        data-testid="search-input"
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="search-field__clear"
          aria-label="Clear search"
          data-testid="search-clear"
          onClick={() => onChange("")}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
