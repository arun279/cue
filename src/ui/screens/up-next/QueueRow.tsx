import { CheckControl } from "@ui/components/CheckControl";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { ProgressBar } from "@ui/components/ProgressBar";
import { SwipeAction } from "@ui/components/SwipeAction";
import { epCode, episodesLeft, lastWatchedPhrase, watchedPercent } from "@ui/format";
import type { MarkWatched } from "@ui/hooks/useMarkWatched";
import { useShowArt } from "@ui/hooks/useShowArt";
import type { UpNextCard } from "@ui/hooks/useUpNext";
import type { ReactElement, ReactNode } from "react";
import { Poster } from "./Poster";
import { useQueueCheck } from "./useQueueCheck";

interface QueueRowProps {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
  /** Stop the show (swipe-left commit); the parent owns the hide + its snackbar. */
  onStop(): void;
  /** Lapsed drawer rows: line 3 leads with relative time. There the idle
   * stretch IS the signal instead of the queue's remaining count. */
  readonly variant?: "queue" | "lapsed";
  /** Extra control after the check (the lapsed drawer's overflow Stop sheet). */
  readonly trailingExtra?: ReactNode;
}

/**
 * One queue-anatomy row: poster + title + quiet episode-code line + progress
 * rail, the whole body a link to show detail, the 48px check trailing. Swipe
 * right marks through the identical check pipeline; swipe left stops the show.
 */
export function QueueRow({
  card,
  mark,
  onStop,
  variant = "queue",
  trailingExtra,
}: QueueRowProps): ReactElement {
  const { entry, item } = card;
  const check = useQueueCheck(entry, mark);
  // Art is deferred out of the cold-sync budget: a row that settles on screen
  // reads its own poster, falling back to any inline list poster until it
  // resolves. The queue is not virtualized, so every row mounts at once; only the
  // ones actually on screen spend a read.
  const art = useShowArt(entry.showId);
  const posters = art.posters.length > 0 ? art.posters : entry.posters;
  const idle = variant === "lapsed" ? lastWatchedPhrase(entry.lastWatchedAt, Date.now()) : null;
  const left = episodesLeft(entry.aired, entry.completed);

  return (
    <SwipeAction
      onSwipeRight={check.state === "unwatched" ? check.onPress : undefined}
      onSwipeLeft={onStop}
    >
      <EpisodeRow
        ref={art.ref}
        variant={variant}
        testId={variant === "lapsed" ? "lapsed-row" : "up-next-card"}
        showId={entry.showId}
        art={<Poster title={entry.title} posters={posters} variant="s48" />}
        title={entry.title}
        meta={
          <>
            <span className="ep-row__code">{epCode(item.episode.season, item.episode.number)}</span>
            {item.episode.title !== null && ` · ${item.episode.title}`}
          </>
        }
        footer={
          <>
            <ProgressBar percent={watchedPercent(entry.completed, entry.aired)} />
            {variant === "queue" && <span className="ep-row__count">{left} left</span>}
            {idle !== null && <span className="ep-row__count">last watched {idle}</span>}
          </>
        }
        trailing={
          <>
            <CheckControl
              state={check.state}
              size={48}
              mode="advance"
              label={check.label}
              onPress={check.onPress}
            />
            {trailingExtra}
          </>
        }
        link={{ to: "/show/$showId", params: { showId: String(entry.showId) } }}
        linkLabel={`${entry.title}, ${epCode(item.episode.season, item.episode.number)}${
          item.episode.title === null ? "" : ` ${item.episode.title}`
        }`}
      />
    </SwipeAction>
  );
}
