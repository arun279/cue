import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ActionSheet, type ActionSheetRow } from "@ui/components/ActionSheet";
import { ConfirmSheet } from "@ui/components/ConfirmSheet";
import { DetailHeroSkeleton } from "@ui/components/DetailHeroSkeleton";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { SkeletonRows } from "@ui/components/Skeletons";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { epCode, middleTruncate, titleCase } from "@ui/format";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useHideShow } from "@ui/hooks/useHideShow";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import { type EpisodeBound, type MarkContextTarget, useMarkSeason } from "@ui/hooks/useMarkSeason";
import { type BackfillOffer, useMarkSnacks } from "@ui/hooks/useMarkSnacks";
import { useMarkWatched } from "@ui/hooks/useMarkWatched";
import { useSeasons } from "@ui/hooks/useSeasons";
import { useShowDetail } from "@ui/hooks/useShowDetail";
import { useToggleWatchlist } from "@ui/hooks/useToggleWatchlist";
import { SheetReturnContext } from "@ui/screens/episode-detail/sheet-return";
import { ExternalLink } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { ContinueBar } from "./ContinueBar";
import { BackDisc, DetailHero } from "./DetailChrome";
import {
  airedUnwatchedCount,
  backfillRangeLabel,
  currentSeasonValue,
  earlierUnwatchedCount,
  lastAiredBound,
  metaLine,
  openExternal,
  seasonCheckFacts,
  traktShowUrl,
  watchRecordLine,
} from "./detail-logic";
import { SeasonList } from "./SeasonList";

type ConfirmState =
  | { readonly kind: "mark-season"; readonly season: SeasonView }
  | { readonly kind: "unmark-season"; readonly season: SeasonView }
  | { readonly kind: "mark-show" };

function eps(count: number): string {
  return `${count} episode${count === 1 ? "" : "s"}`;
}

function About({
  header,
  runtime,
}: {
  readonly header: ShowHeader;
  readonly runtime: number | null;
}): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const facts = metaLine([...header.genres.slice(0, 3).map(titleCase), header.network]);
  const record = watchRecordLine(header.completed, header.aired, runtime);
  if (header.overview === null && facts === "" && record === null) return null;
  return (
    <section className="detail-about">
      {header.overview !== null && (
        <div className="detail-about__overview">
          <p className="clamp-4" data-expanded={expanded} data-testid="detail-overview">
            {header.overview}
          </p>
          {!expanded && (
            <button type="button" className="text-more" onClick={() => setExpanded(true)}>
              More
            </button>
          )}
        </div>
      )}
      {facts !== "" && <p className="detail-about__facts">{facts}</p>}
      {record !== null && (
        <p className="detail-about__record" data-testid="detail-record">
          {record}
        </p>
      )}
    </section>
  );
}

/**
 * Show detail (§3.3): full-bleed hero, the sticky continue bar running the same
 * advance pipeline as the Up Next queue, the seasons accordion with bulk season
 * checks (confirm flows §4.5) and per-episode toggles (backfill snackbar §4.3),
 * and the About block. The episode sheet is a child route presented over this
 * page; the overflow disc carries stop/resume, watchlist, whole-show marking,
 * and the Trakt hand-off. Every state is designed: hero skeleton, hero error
 * retry, season skeletons, season error retry, and an announced-only empty tree.
 */
export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const detail = useShowDetail(showId);
  const seasonsView = useSeasons(showId);
  const marks = useMarkSeason();
  const mark = useMarkWatched();
  const hide = useHideShow();
  const watchlist = useToggleWatchlist();
  const entry = useLibrarySnapshot().byId.get(showId);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // The confirm content outlives `confirmOpen` so the sheet keeps its copy
  // through the exit animation instead of vanishing mid-dismissal.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openConfirm = (next: ConfirmState): void => {
    setConfirm(next);
    setConfirmOpen(true);
  };
  const backfillRef = useRef<BackfillOffer | null>(null);
  // Fresh season tree for deferred actions (the "+N earlier" backfill runs after
  // the single mark already patched the cache; a stale closure would re-mark it).
  const seasonsRef = useRef(seasonsView.seasons);
  seasonsRef.current = seasonsView.seasons;
  useMarkSnacks(marks, { backfill: backfillRef });

  // How the episode sheet (this route's child) should close: once this page has
  // rendered WITHOUT the sheet, the sheet was pushed over it and Back returns here.
  const episodeOpen = useRouterState({
    select: (state) => state.location.pathname.includes("/episode/"),
  });
  const returnRef = useRef(false);
  useEffect(() => {
    if (!episodeOpen) returnRef.current = true;
  }, [episodeOpen]);

  const header = detail.header;
  useDocumentTitle(
    episodeOpen ? null : header !== undefined ? `${header.title} · Cue` : "Show · Cue",
  );

  // Stop/resume + watchlist feedback (§4.3): keyed on primitives so a re-render
  // while the snack is up never replaces it and resets its timer.
  const stopKind = hide.undoable?.kind ?? null;
  const stopTitle = hide.undoable?.title ?? null;
  const { undo: hideUndo } = hide;
  useEffect(() => {
    if (stopKind === null || stopTitle === null) return;
    showSnack({
      message: `${middleTruncate(stopTitle)} ${stopKind === "hide" ? "stopped" : "resumed"}`,
      actions: [
        {
          label: "Undo",
          testId: "snackbar-undo",
          onPress: () => {
            dismissSnack();
            void hideUndo();
          },
        },
      ],
    });
  }, [stopKind, stopTitle, hideUndo]);
  const hideError = hide.error;
  const { clearError: clearHideError } = hide;
  useEffect(() => {
    if (hideError === null) return;
    showSnack({ message: hideError, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
    clearHideError();
  }, [hideError, clearHideError]);
  const watchlistError = watchlist.error;
  const { clearError: clearWatchlistError } = watchlist;
  useEffect(() => {
    if (watchlistError === null) return;
    showSnack({ message: watchlistError, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
    clearWatchlistError();
  }, [watchlistError, clearWatchlistError]);
  // The Undo on the watchlist snack must see the post-add membership, not the
  // closure it was created in.
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;

  // Loading/error still render the Outlet + return context: a cold deep link to
  // the episode URL presents the sheet (with its own skeleton) over this state,
  // so the two reads race in parallel instead of serializing.
  if (detail.isLoading) {
    return (
      <SheetReturnContext.Provider value={returnRef}>
        <section className="screen-detail" data-testid="screen-show-detail">
          <DetailHeroSkeleton testId="detail-skeleton" />
        </section>
        <Outlet />
      </SheetReturnContext.Provider>
    );
  }

  if (header === undefined) {
    return (
      <SheetReturnContext.Provider value={returnRef}>
        <section className="screen-detail" data-testid="screen-show-detail">
          <BackDisc />
          <ErrorRetry
            title="Couldn't load this show"
            testId="detail-error"
            buttonTestId="detail-error-retry"
            onRetry={detail.refetch}
          />
        </section>
        <Outlet />
      </SheetReturnContext.Provider>
    );
  }

  const seasons = seasonsView.seasons;
  const hidden = entry?.hidden ?? false;
  const runtime = entry?.runtime ?? null;
  const targetFor = (seasonNumber: number): MarkContextTarget => ({
    showId,
    ids: header.ids,
    includeSpecials: seasonNumber === 0,
  });

  const onEpisodeToggle = (season: SeasonView, episode: EpisodeView): void => {
    const target = targetFor(season.number);
    if (episode.watched) {
      backfillRef.current = null;
      void marks.toggleEpisode(target, episode);
      return;
    }
    const bound: EpisodeBound = { season: episode.season, number: episode.number };
    const code = epCode(episode.season, episode.number);
    const gap = earlierUnwatchedCount(seasonsRef.current, bound);
    const label = gap > 0 ? `${code} marked` : `${middleTruncate(header.title)} ${code} marked`;
    backfillRef.current =
      gap > 0
        ? {
            markLabel: label,
            count: gap,
            run: () => {
              const fresh = seasonsRef.current;
              void marks.markUpToHere(targetFor(1), fresh, bound, {
                label: backfillRangeLabel(fresh, bound, gap),
                absorbUndo: true,
              });
            },
          }
        : null;
    void marks.toggleEpisode(target, episode, { undoLabel: label });
  };

  const onSeasonCheck = (season: SeasonView): void => {
    openConfirm(
      seasonCheckFacts(season).complete
        ? { kind: "unmark-season", season }
        : { kind: "mark-season", season },
    );
  };

  const onFallbackMark = (): void => {
    const next = header.nextEpisode;
    if (next === null) return;
    backfillRef.current = null;
    void marks.toggleEpisode(targetFor(next.season), next, {
      undoLabel: `${middleTruncate(header.title)} ${epCode(next.season, next.number)} marked`,
    });
  };

  const canStop = hidden || header.completed > 0;
  const offerWatchlist =
    header.completed === 0 && !watchlist.isLoading && !watchlist.isOnWatchlist(showId);
  const unwatchedTotal = airedUnwatchedCount(seasons);
  const overflowRows: ActionSheetRow[] = [
    ...(canStop
      ? [
          {
            label: hidden ? "Resume show" : "Stop show",
            testId: "overflow-stop",
            onPress: () => {
              void (hidden
                ? hide.unhide(showId, header.ids, header.title)
                : hide.hide(showId, header.ids, header.title));
            },
          },
        ]
      : []),
    ...(offerWatchlist
      ? [
          {
            label: "Move to Watchlist",
            testId: "overflow-watchlist",
            onPress: () => {
              void watchlist.toggle(header.ids);
              showSnack({
                message: `${middleTruncate(header.title)} added to Watchlist`,
                actions: [
                  {
                    label: "Undo",
                    testId: "snackbar-undo",
                    onPress: () => {
                      dismissSnack();
                      void watchlistRef.current.toggle(header.ids);
                    },
                  },
                ],
              });
            },
          },
        ]
      : []),
    ...(unwatchedTotal > 0
      ? [
          {
            label: "Mark whole show watched…",
            testId: "overflow-mark-show",
            onPress: () => openConfirm({ kind: "mark-show" }),
          },
        ]
      : []),
    {
      label: "Open on Trakt",
      icon: <ExternalLink aria-hidden="true" />,
      testId: "overflow-trakt",
      onPress: () => openExternal(traktShowUrl(header.ids)),
    },
  ];

  let confirmView: {
    readonly title: string;
    readonly body: string;
    readonly primary: { readonly label: string; readonly danger?: boolean; onPress(): void };
    readonly secondary?: { readonly label: string; readonly testId?: string; onPress(): void };
  } | null = null;
  if (confirm !== null && confirm.kind !== "mark-show") {
    const season = confirm.season;
    const name = season.isSpecial ? "Specials" : `Season ${season.number}`;
    const { airedDone } = seasonCheckFacts(season);
    if (confirm.kind === "unmark-season") {
      confirmView = {
        title: `Unmark ${name}?`,
        body: `Removes ${eps(airedDone)} from your history.`,
        primary: {
          label: `Remove ${eps(airedDone)}`,
          danger: true,
          onPress: () => void marks.unmarkSeason(targetFor(season.number), season),
        },
      };
    } else {
      const remaining = season.airedCount - airedDone;
      confirmView = {
        title: `Mark ${name} watched?`,
        body:
          airedDone === 0
            ? `${eps(remaining)} will be added to your history.`
            : `${remaining} of ${season.airedCount} episodes are unwatched.`,
        primary: {
          label: airedDone === 0 ? `Mark ${eps(remaining)}` : `Mark ${remaining} remaining`,
          onPress: () => void marks.markSeason(targetFor(season.number), season),
        },
        ...(airedDone === 0
          ? {}
          : {
              secondary: {
                label: `Mark all ${season.airedCount} again (rewatch)`,
                testId: "confirm-sheet-rewatch",
                onPress: () => void marks.rewatchSeason(targetFor(season.number), season),
              },
            }),
      };
    }
  } else if (confirm !== null) {
    const bound = lastAiredBound(seasons);
    confirmView = {
      title: "Mark whole show watched?",
      body: `${eps(unwatchedTotal)} will be added to your history.`,
      primary: {
        label: `Mark ${eps(unwatchedTotal)}`,
        onPress: () => {
          if (bound !== null) {
            void marks.markUpToHere(targetFor(1), seasonsRef.current, bound, {
              label: `${middleTruncate(header.title)} marked · ${eps(unwatchedTotal)}`,
            });
          }
        },
      },
    };
  }

  return (
    <SheetReturnContext.Provider value={returnRef}>
      <section className="screen-detail" data-testid="screen-show-detail">
        <DetailHero
          header={header}
          meta={metaLine([
            header.year === null ? null : String(header.year),
            header.status === "" ? null : titleCase(header.status),
            header.network,
            runtime === null ? null : `${runtime} min`,
          ])}
          testIds={{ hero: "detail-hero", backdrop: "hero-backdrop", title: "detail-title" }}
          onOverflow={() => setOverflowOpen(true)}
        />

        <ContinueBar
          showId={showId}
          header={header}
          entry={entry}
          mark={mark}
          onFallbackMark={onFallbackMark}
        />

        {seasonsView.isLoading && <SkeletonRows rows={3} testId="seasons-loading" />}
        {!seasonsView.isLoading && seasonsView.isError && !seasonsView.hasData && (
          <div className="detail-inline-error" data-testid="seasons-error">
            <span>Couldn't load episodes</span>
            <button
              type="button"
              className="detail-inline-error__retry"
              data-testid="seasons-error-retry"
              onClick={seasonsView.refetch}
            >
              Retry
            </button>
          </div>
        )}
        {!seasonsView.isLoading && seasonsView.hasData && seasons.length === 0 && (
          <EmptyState
            testId="seasons-empty"
            headline="No episodes announced yet"
            body="Seasons land here as soon as this show has episodes."
          />
        )}
        {seasons.length > 0 && (
          <SeasonList
            showId={showId}
            seasons={seasons}
            defaultOpen={currentSeasonValue(seasons, header.nextEpisode)}
            onSeasonCheck={onSeasonCheck}
            onEpisodeToggle={onEpisodeToggle}
          />
        )}

        <About header={header} runtime={runtime} />

        <ActionSheet
          open={overflowOpen}
          onOpenChange={setOverflowOpen}
          title={header.title}
          rows={overflowRows}
        />
        {confirmView !== null && (
          <ConfirmSheet
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={confirmView.title}
            body={confirmView.body}
            primary={{ ...confirmView.primary, testId: "confirm-sheet-primary" }}
            {...(confirmView.secondary === undefined ? {} : { secondary: confirmView.secondary })}
          />
        )}
      </section>
      <Outlet />
    </SheetReturnContext.Provider>
  );
}
