import type { TmdbImageConfig } from "@data/image-source";
import { Link } from "@tanstack/react-router";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import { Accordion } from "radix-ui";
import type { ReactElement } from "react";
import { episodeCode, relativeDays } from "./format";
import { Poster } from "./Poster";

interface LapsedDrawerProps {
  readonly cards: readonly UpNextCardModel[];
  readonly tmdbConfig: TmdbImageConfig | null;
  /** Catch up in place — mark the lapsed show's next episode, re-sorting it to Continue. */
  onMark(card: UpNextCardModel): void;
  /** Stop watching a lapsed show — the parent owns the hide + its Undo snackbar. */
  onStop(card: UpNextCardModel): void;
}

/** One row in the drawer: the show (poster + title route to Show detail), the next
 * episode + how long it's been, and the two one-tap decisions Watched / Stop watching. */
function LapsedRow({
  card,
  tmdbConfig,
  onMark,
  onStop,
}: {
  readonly card: LapsedDrawerProps["cards"][number];
  readonly tmdbConfig: TmdbImageConfig | null;
  onMark(): void;
  onStop(): void;
}): ReactElement {
  const { entry, item } = card;
  const code = episodeCode(item.episode.season, item.episode.number);
  const lastWatched = relativeDays(entry.lastWatchedAt, Date.now());
  const showParams = { showId: String(entry.showId) };

  return (
    <article className="lapsed-row" data-testid="lapsed-row" data-show-id={entry.showId}>
      <Link
        to="/show/$showId"
        params={showParams}
        className="card__poster-link"
        tabIndex={-1}
        aria-label={entry.title}
      >
        <span className="poster-wrap poster-wrap--sm">
          <Poster
            title={entry.title}
            posters={entry.posters}
            tmdbConfig={tmdbConfig}
            variant="queue"
          />
        </span>
      </Link>
      <div className="card__body">
        <Link to="/show/$showId" params={showParams} className="card__title-link">
          <h3 className="lapsed-row__title">{entry.title}</h3>
        </Link>
        <p className="card__meta">
          <span className="card__code">{code}</span>
          {lastWatched !== null && <span> · last watched {lastWatched}</span>}
        </p>
      </div>
      <div className="lapsed-row__actions">
        <button
          type="button"
          className="button button--sm lapsed-row__mark"
          data-testid="lapsed-mark"
          aria-label={`Mark ${entry.title} ${code} watched`}
          aria-disabled={entry.pendingAdvance}
          aria-busy={entry.pendingAdvance}
          onClick={onMark}
        >
          Watched
        </button>
        <button
          type="button"
          className="button button--ghost button--sm lapsed-row__stop"
          data-testid="lapsed-stop"
          onClick={onStop}
        >
          Stop watching
        </button>
      </div>
    </article>
  );
}

/**
 * "Haven't watched in a while" — the soft, collapsed drawer at the bottom of Up
 * Next for in-progress-but-idle shows (longest-idle first). It is a pruning prompt,
 * never a wall of shame: each row offers a one-tap Watched (the direct catch-up
 * path — marking re-sorts the show to the top of Continue) or Stop watching (the
 * parent's optimistic hide + Undo). A decided show leaves the drawer on its own,
 * so there is no local per-session dismissal to lose on reload.
 */
export function LapsedDrawer({
  cards,
  tmdbConfig,
  onMark,
  onStop,
}: LapsedDrawerProps): ReactElement | null {
  if (cards.length === 0) return null;

  return (
    <Accordion.Root
      type="single"
      collapsible
      className="piles lapsed-drawer"
      data-testid="lapsed-drawer"
    >
      <Accordion.Item className="pile" value="lapsed" data-status="lapsed">
        <Accordion.Header className="pile__header">
          <Accordion.Trigger className="pile__trigger" data-testid="lapsed-heading">
            <svg className="pile__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="pile__name">Haven't watched in a while</span>
            <span className="pile__count library-heading__count" data-testid="lapsed-count">
              {cards.length}
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="pile__content">
          <ul className="lapsed-list">
            {cards.map((card) => (
              <li key={card.entry.showId}>
                <LapsedRow
                  card={card}
                  tmdbConfig={tmdbConfig}
                  onMark={() => onMark(card)}
                  onStop={() => onStop(card)}
                />
              </li>
            ))}
          </ul>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}
