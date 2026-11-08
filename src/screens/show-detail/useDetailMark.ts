import { epCode } from "@/core/domain/model/library";
import {
  type EpisodeView,
  earlierUnwatchedCount,
  patchEpisodes,
  type SeasonView,
} from "@/core/domain/show-detail";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { addSnackAction, useSnackbar } from "@/core/stores/snackbar-store";

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
      addSnackAction({
        label: `+${earlier} earlier`,
        onPress: () =>
          void controller.markUpToHere(
            { ...target, includeSpecials: false },
            patchEpisodes(seasons, (s, n) => s === episode.season && n === episode.number, true),
            episode,
            { absorbUndo: true },
          ),
      });
    },
  };
}
