import { resolveStill } from "@data/image-source";
import type { EpisodeDetail, EpisodeNav } from "@data/trakt/episode-detail";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ActionSheet, type ActionSheetRow } from "@ui/components/ActionSheet";
import { CheckControl } from "@ui/components/CheckControl";
import { ConfirmSheet } from "@ui/components/ConfirmSheet";
import { ContextMenu } from "@ui/components/ContextMenu";
import { CountdownPanel } from "@ui/components/CountdownPanel";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { Sheet } from "@ui/components/Sheet";
import { epCode, middleTruncate } from "@ui/format";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useEpisode } from "@ui/hooks/useEpisode";
import { useEpisodePlays } from "@ui/hooks/useEpisodePlays";
import {
  type EpisodeBound,
  type MarkContextTarget,
  type MarkSeasonController,
  useMarkSeason,
} from "@ui/hooks/useMarkSeason";
import { type BackfillOffer, useMarkSnacks } from "@ui/hooks/useMarkSnacks";
import { useSeasons } from "@ui/hooks/useSeasons";
import { useShowDetail } from "@ui/hooks/useShowDetail";
import { usePrefs } from "@ui/prefs/prefs-store";
import {
  backfillRangeLabel,
  earlierUnwatchedCount,
  openExternal,
  traktEpisodeUrl,
} from "@ui/screens/show-detail/detail-logic";
import { Ellipsis, ExternalLink } from "lucide-react";
import { type ReactElement, useContext, useEffect, useRef, useState } from "react";
import { removeAllBody, sheetMetaLine, watchedStatusLine } from "./sheet-logic";
import { SheetReturnContext } from "./sheet-return";

/** Matches the sheet's exit animation (`--dur-base`) so the panel finishes
 * leaving before the route beneath swallows it. */
const CLOSE_MS = 200;

/** The spoiler-guarded 16:9 still: blurred with a reveal chip until the episode
 * is watched (or revealed); a missing/broken still renders nothing at all. */
function StillBlock({
  url,
  guarded,
  onReveal,
}: {
  readonly url: string;
  readonly guarded: boolean;
  onReveal(): void;
}): ReactElement | null {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === url) return null;
  if (guarded) {
    return (
      <button
        type="button"
        className="ep-sheet__still ep-sheet__still--guarded"
        aria-label="Reveal episode still"
        data-testid="still-reveal"
        onClick={onReveal}
      >
        <img src={url} alt="" decoding="async" onError={() => setBroken(url)} />
        <span className="ep-sheet__reveal" aria-hidden="true">
          Tap to reveal
        </span>
      </button>
    );
  }
  return (
    <div className="ep-sheet__still">
      <img
        src={url}
        alt=""
        decoding="async"
        data-testid="episode-still"
        onError={() => setBroken(url)}
      />
    </div>
  );
}

/** The 64px elevated mark row: status text left, the 56px toggle check right.
 * A watched check long-presses into the rewatch menu (§4.4.2). */
function MarkRow({
  episode,
  plays,
  onToggle,
  menuRows,
}: {
  readonly episode: EpisodeDetail;
  readonly plays: number | null;
  onToggle(): void;
  readonly menuRows: readonly ActionSheetRow[];
}): ReactElement {
  const code = epCode(episode.season, episode.number);
  const check = (
    <CheckControl
      size={56}
      state={episode.watched ? "watched" : "unwatched"}
      label={episode.watched ? "Watched — tap to remove" : `Mark ${code} watched`}
      testId="episode-sheet-check"
      {...(plays !== null && plays > 1 ? { plays } : {})}
      onPress={onToggle}
    />
  );
  return (
    <div className="mark-row" data-testid="episode-mark-row">
      <span className="mark-row__text">
        <span className="mark-row__status">
          {episode.watched ? watchedStatusLine(episode.watchedAt, plays) : "Not watched yet"}
        </span>
        {episode.watched && (plays ?? 1) < 2 && (
          <span className="mark-row__hint">tap the check to remove</span>
        )}
      </span>
      {episode.watched ? (
        <ContextMenu title={code} rows={menuRows}>
          {check}
        </ContextMenu>
      ) : (
        check
      )}
    </div>
  );
}

function PagerButton({
  target,
  direction,
  onGo,
}: {
  readonly target: EpisodeNav | null;
  readonly direction: "prev" | "next";
  onGo(target: EpisodeNav): void;
}): ReactElement {
  const code = target === null ? null : epCode(target.season, target.number);
  return (
    <button
      type="button"
      className="ep-sheet__page"
      data-direction={direction}
      data-testid={`episode-${direction}`}
      disabled={target === null}
      aria-label={
        target === null
          ? `No ${direction === "prev" ? "earlier" : "later"} episode`
          : `${direction === "prev" ? "Previous" : "Next"} episode: ${code}`
      }
      onClick={() => {
        if (target !== null) onGo(target);
      }}
    >
      {direction === "prev" ? `‹ ${code ?? ""}` : `${code ?? ""} ›`}
    </button>
  );
}

/**
 * The episode surface: a route-backed bottom sheet (§3.4) presented over the
 * show page. Still (spoiler-guarded by the stills pref), quiet meta line, title,
 * clamped overview, the mark row with the plays-aware toggle, and a footer pager
 * that replaces the URL in place so one Back always lands beneath the sheet.
 * Unaired episodes trade the still for a countdown and carry no check. Every
 * mark path runs through the same show-surface controller the season list uses,
 * so both surfaces tick together and share one snackbar grammar.
 */
export function EpisodeSheet({
  showId,
  season,
  number,
}: {
  readonly showId: number;
  readonly season: number;
  readonly number: number;
}): ReactElement {
  const view = useEpisode(showId, season, number);
  const show = useShowDetail(showId);
  const seasonsView = useSeasons(showId);
  const marks: MarkSeasonController = useMarkSeason();
  const episode = view.episode;
  const plays = useEpisodePlays(episode?.ids.trakt, episode?.watched ?? false);
  const hideStills = usePrefs((s) => s.hideStillsUntilWatched);
  const navigate = useNavigate();
  const router = useRouter();
  const returnRef = useContext(SheetReturnContext);

  const [open, setOpen] = useState(true);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const backfillRef = useRef<BackfillOffer | null>(null);
  // Fresh season tree for the backfill: the offer runs AFTER the single mark
  // patched the cache, and a stale closure would re-mark the tapped episode.
  const seasonsRef = useRef(seasonsView.seasons);
  seasonsRef.current = seasonsView.seasons;
  useMarkSnacks(marks, { backfill: backfillRef, onAfterUndo: plays.refresh });

  // Both pager directions swap the episode in place (`replace`), so paging
  // through a season never stacks history entries under one sheet.
  const goToEpisode = (nav: EpisodeNav): void =>
    void navigate({
      to: "/show/$showId/episode/$season/$episode",
      params: {
        showId: String(showId),
        season: String(nav.season),
        episode: String(nav.number),
      },
      replace: true,
    });

  const code = epCode(season, number);
  useDocumentTitle(
    show.header !== undefined ? `${show.header.title} · ${code} · Cue` : `${code} · Cue`,
  );

  // Close = the sheet's exit animation, then leave the route: back to the show
  // page it was pushed over, or replace the URL for a cold/direct arrival.
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      if (returnRef?.current === true) {
        router.history.back();
      } else {
        void navigate({ to: "/show/$showId", params: { showId: String(showId) }, replace: true });
      }
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, returnRef, router, navigate, showId]);

  const epId = `${season}:${number}`;
  const showIds = show.header?.ids ?? { trakt: showId };
  const target: MarkContextTarget = { showId, ids: showIds, includeSpecials: false };

  const onToggle = (ep: EpisodeDetail): void => {
    if (ep.watched) {
      backfillRef.current = null;
      void marks
        .toggleEpisode(target, ep, plays.count === null ? {} : { knownPlays: plays.count })
        .then(plays.refresh);
      return;
    }
    const bound: EpisodeBound = { season: ep.season, number: ep.number };
    const gap = earlierUnwatchedCount(seasonsRef.current, bound);
    const showTitle = show.header?.title;
    const label =
      gap > 0
        ? `${code} marked`
        : `${showTitle === undefined ? "" : `${middleTruncate(showTitle)} `}${code} marked`;
    backfillRef.current =
      gap > 0
        ? {
            markLabel: label,
            count: gap,
            run: () => {
              const seasons = seasonsRef.current;
              void marks
                .markUpToHere(target, seasons, bound, {
                  label: backfillRangeLabel(seasons, bound, gap),
                  absorbUndo: true,
                })
                .then(plays.refresh);
            },
          }
        : null;
    void marks.toggleEpisode(target, ep, { undoLabel: label }).then(plays.refresh);
  };

  const menuRows: ActionSheetRow[] = [
    {
      label: "Add another play",
      testId: "menu-add-play",
      onPress: () => {
        if (episode !== undefined) void marks.addEpisodePlay(target, episode).then(plays.refresh);
      },
    },
    ...((plays.count ?? 0) >= 2
      ? [
          {
            label: `Remove all ${plays.count} plays…`,
            danger: true,
            testId: "menu-remove-all",
            onPress: () => setRemoveAllOpen(true),
          },
        ]
      : []),
  ];

  const overflowRows: ActionSheetRow[] = [
    ...(episode?.watched === true
      ? [
          {
            label: "Add another play",
            testId: "sheet-overflow-add-play",
            onPress: () => {
              void marks.addEpisodePlay(target, episode).then(plays.refresh);
            },
          },
        ]
      : []),
    {
      label: "Open on Trakt",
      icon: <ExternalLink aria-hidden="true" />,
      testId: "sheet-overflow-trakt",
      onPress: () => openExternal(traktEpisodeUrl(showIds, { season, number })),
    },
  ];

  const stillUrl = episode === undefined ? null : resolveStill(episode.stills);
  const guarded = hideStills && episode?.watched === false && revealedKey !== epId;
  const expanded = expandedKey === epId;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        detents="tall"
      >
        <article className="ep-sheet" data-testid="episode-sheet">
          <div className="ep-sheet__header">
            <button
              type="button"
              className="ep-sheet__overflow"
              aria-label={`More actions for ${code}`}
              aria-haspopup="dialog"
              data-testid="sheet-overflow"
              onClick={() => setOverflowOpen(true)}
            >
              <Ellipsis aria-hidden="true" />
            </button>
          </div>

          {view.isLoading && (
            <div className="ep-sheet__skel" data-testid="episode-skeleton" aria-hidden="true">
              <div className="ep-sheet__skel-still" />
              <div className="ep-sheet__skel-bar" />
              <div className="ep-sheet__skel-bar ep-sheet__skel-bar--wide" />
              <div className="ep-sheet__skel-bar" />
            </div>
          )}

          {!view.isLoading && episode === undefined && (
            <ErrorRetry
              title="Couldn't load this episode"
              testId="episode-error"
              buttonTestId="episode-error-retry"
              onRetry={view.refetch}
            />
          )}

          {episode !== undefined && (
            <>
              {episode.aired ? (
                stillUrl !== null && (
                  <StillBlock
                    key={epId}
                    url={stillUrl}
                    guarded={guarded}
                    onReveal={() => setRevealedKey(epId)}
                  />
                )
              ) : episode.firstAired !== null ? (
                <CountdownPanel mode="unaired-episode" date={episode.firstAired} />
              ) : null}

              <p className="ep-sheet__meta" data-testid="episode-detail-code">
                {sheetMetaLine(episode)}
              </p>
              <h2
                className="ep-sheet__title"
                id="episode-sheet-title"
                data-testid="episode-detail-title"
              >
                {episode.title ?? code}
              </h2>

              {episode.overview !== null && (
                <div className="ep-sheet__overview">
                  <p
                    className="clamp-4"
                    data-expanded={expanded}
                    data-testid="episode-detail-overview"
                  >
                    {episode.overview}
                  </p>
                  {!expanded && (
                    <button
                      type="button"
                      className="text-more"
                      onClick={() => setExpandedKey(epId)}
                    >
                      More
                    </button>
                  )}
                </div>
              )}

              {episode.aired && (
                <MarkRow
                  episode={episode}
                  plays={plays.count}
                  onToggle={() => onToggle(episode)}
                  menuRows={menuRows}
                />
              )}

              <footer className="ep-sheet__pager">
                <PagerButton target={episode.prev} direction="prev" onGo={goToEpisode} />
                <PagerButton target={episode.next} direction="next" onGo={goToEpisode} />
              </footer>
            </>
          )}
          {/* Same id as the loaded title: the dialog's aria-labelledby stays
              live across the loading → loaded swap. */}
          {episode === undefined && (
            <h2 className="sr-only" id="episode-sheet-title">
              {code}
            </h2>
          )}
        </article>
      </Sheet>

      <ActionSheet
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        title={episode?.title ?? code}
        rows={overflowRows}
      />
      {episode !== undefined && (
        <ConfirmSheet
          open={removeAllOpen}
          onOpenChange={setRemoveAllOpen}
          title="Remove all plays?"
          body={removeAllBody(code, plays.count ?? 2)}
          primary={{
            label: `Remove ${plays.count ?? 2} plays`,
            danger: true,
            testId: "confirm-sheet-primary",
            onPress: () => {
              void marks.removeAllPlays(target, episode).then(plays.refresh);
            },
          }}
        />
      )}
    </>
  );
}
