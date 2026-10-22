import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { confirm } from "../../ui/confirm";
import { HeaderMenu, RowMenu } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import type { useDetailMark } from "../show-detail/useDetailMark";

export function EpisodeMenu({
  detail,
  plays,
  mark,
}: {
  readonly detail: EpisodeDetail;
  readonly plays: number;
  readonly mark: ReturnType<typeof useDetailMark>;
}): ReactElement {
  const code = epCode(detail.season, detail.number);
  const Menu = Platform.OS === "ios" ? HeaderMenu : RowMenu;
  return (
    <Menu
      title={detail.title ?? code}
      testID={TEST_IDS.episodeMore}
      items={[
        {
          id: "add-play",
          label: "Add another play",
          available: detail.aired && detail.watched,
          onPress: () => void mark.controller.addEpisodePlay(mark.target, detail),
        },
        {
          id: "remove-plays",
          label: `Remove all ${plays} plays…`,
          available: detail.watched && plays > 0,
          destructive: true,
          onPress: () =>
            confirm({
              title: "Remove all plays?",
              message: `${code} has ${plays} plays. This removes all ${plays} from your history.`,
              primary: `Remove ${plays} plays`,
              onPrimary: () => void mark.controller.removeAllPlays(mark.target, detail),
            }),
        },
      ]}
    />
  );
}
