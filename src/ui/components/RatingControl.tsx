import type { EpisodeIds, MovieIds, ShowIds } from "@domain/model/ids";
import type { RateController } from "@ui/hooks/useRate";
import type { ReactElement } from "react";

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

interface RatingControlProps {
  readonly ids: ShowIds | EpisodeIds | MovieIds;
  readonly label: string;
  readonly controller: RateController;
  readonly testId: string;
}

/**
 * The 1–10 rating control. A labelled group of toggle buttons (Shneiderman:
 * direct selection, reversible), keyboard operable with a visible focus ring; each
 * button carries its own accessible name and pressed state (the numeric glyph is
 * not the only cue for assistive tech). The current rating is announced politely;
 * a Clear action appears only when rated, so "remove rating" is discoverable
 * without cluttering the unrated state.
 */
export function RatingControl({
  ids,
  label,
  controller,
  testId,
}: RatingControlProps): ReactElement {
  const current = controller.ratingFor(ids.trakt);
  // Lock the scale until the existing-ratings read resolves so a click can't fire a
  // write against unknown prior state (e.g. re-adding an already-set rating).
  const locked = controller.isLoading;
  const status = controller.isLoading
    ? "Loading your rating…"
    : controller.isError
      ? "Couldn't load your rating."
      : current === null
        ? "Not rated"
        : `Your rating: ${current}/10`;
  return (
    <div className="rating" data-testid={testId}>
      <fieldset
        className="rating__scale"
        aria-label={`${label} — rate 1 to 10`}
        aria-busy={locked}
        disabled={locked}
        data-testid={`${testId}-scale`}
      >
        {VALUES.map((value) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              aria-label={`Rate ${value} out of 10`}
              className="rating__star"
              data-selected={selected}
              data-value={value}
              data-testid={`${testId}-value-${value}`}
              onClick={() => void controller.rate(ids, value)}
            >
              {value}
            </button>
          );
        })}
      </fieldset>
      <p className="rating__status" data-testid={`${testId}-current`} aria-live="polite">
        {status}
      </p>
      {current !== null && !locked && (
        <button
          type="button"
          className="button button--ghost button--sm"
          data-testid={`${testId}-clear`}
          onClick={() => void controller.clearRating(ids)}
        >
          Remove rating
        </button>
      )}
    </div>
  );
}
