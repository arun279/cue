import { useSearch } from "@ui/hooks/useSearch";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { type ReactElement, type ReactNode, useId } from "react";
import { SearchResultRow } from "./SearchResultRow";

/**
 * Discover / Search. A debounced type-ahead across shows + movies:
 * one request fires after the user settles, and each hit carries an inline
 * watchlist add. Every state is designed — a pre-query state (with recent
 * searches), an in-flight state, a no-results state, a hard-error retry, and the
 * result list.
 */
export function Search(): ReactElement {
  const view = useSearch();
  const inputId = useId();

  let body: ReactNode;
  if (view.status === "idle") {
    body = (
      <div className="empty" data-testid="search-prequery">
        <h2 className="empty__title">Find a show or movie</h2>
        <p className="empty__body">Search to add anything to your watchlist or library.</p>
        {view.recent.length > 0 && (
          <div className="search-recent" data-testid="search-recent">
            <p className="search-recent__label">Recent searches</p>
            <ul className="search-recent__list">
              {view.recent.map((term) => (
                <li key={term}>
                  <button
                    type="button"
                    className="badge search-recent__chip"
                    data-testid="search-recent-chip"
                    onClick={() => view.setInput(term)}
                  >
                    {term}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else if (view.status === "searching") {
    body = (
      <p className="search-status" role="status" data-testid="search-searching">
        Searching…
      </p>
    );
  } else if (view.status === "error") {
    body = (
      <div className="empty" data-testid="search-error">
        <h2 className="empty__title">Search failed</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="search-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.status === "empty") {
    body = (
      <div className="empty" data-testid="search-no-results">
        <h2 className="empty__title">No matches for "{view.query}"</h2>
        <p className="empty__body">Try a different title or check the spelling.</p>
      </div>
    );
  } else {
    body = (
      <ul className="card-list" data-testid="search-results">
        {view.hits.map((hit) => (
          <li key={hit.key}>
            <SearchResultRow
              hit={hit}
              tmdbConfig={null}
              added={view.isAdded(hit)}
              onAdd={() => void view.add(hit)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="screen screen--full" data-testid="screen-discover">
      <header className="screen__head">
        <h1 className="screen__title">Discover</h1>
      </header>

      <search className="search-bar">
        <label className="search-bar__label" htmlFor={inputId}>
          Search shows and movies
        </label>
        <input
          id={inputId}
          type="search"
          className="field__input search-bar__input"
          data-testid="search-input"
          placeholder="Search shows and movies…"
          autoComplete="off"
          value={view.input}
          onChange={(event) => view.setInput(event.target.value)}
        />
      </search>

      {body}

      {view.addError !== null && (
        <Snackbar
          testId="search-add-error"
          message={view.addError}
          actionLabel="Dismiss"
          onAction={view.clearAddError}
          onDismiss={view.clearAddError}
        />
      )}
    </section>
  );
}
