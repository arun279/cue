import type { EpisodeView, SeasonView } from "@cue/core/data/trakt/show-detail";
import { epCode } from "@cue/core/domain/model/library";
import { earlierUnwatchedCount } from "@cue/core/domain/show-detail";
import { useMarkSeason } from "@cue/core/hooks/useMarkSeason";
import { showSnack, useSnackbar } from "@cue/core/stores/snackbar-store";

export function useDetailMark(showId: number, seasons: readonly SeasonView[]) {
  const controller = useMarkSeason();
  const target = { showId, ids: { trakt: showId }, includeSpecials: true };
  return {
    controller,
    target,
    toggle: (
      episode: Pick<EpisodeView, "season" | "number" | "ids" | "watched" | "watchedAt">,
      knownPlays?: number,
    ): void => {
      const earlier = episode.watched ? 0 : earlierUnwatchedCount(seasons, episode);
      const previous = useSnackbar.getState().snack;
      void controller.toggleEpisode(target, episode, {
        undoLabel: `${epCode(episode.season, episode.number)} marked`,
        knownPlays,
      });
      const snack = useSnackbar.getState().snack;
      if (earlier === 0 || snack === null || snack === previous) return;
      showSnack({
        message: snack.message,
        actions: [
          {
            label: `+${earlier} earlier`,
            onPress: () =>
              void controller.markUpToHere(
                { ...target, includeSpecials: false },
                seasons,
                episode,
                { absorbUndo: true },
              ),
          },
          ...(snack.actions ?? []),
        ],
      });
    },
  };
}
