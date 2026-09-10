import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import type { ReactElement } from "react";
import { RowMenu } from "../../ui/RowMenu";
import type { Confirmation } from "../../ui/useConfirmation";
import type { useDetailMark } from "../show-detail/useDetailMark";

export function EpisodeMenu({
  detail,
  plays,
  mark,
  confirm,
  children,
}: {
  readonly detail: EpisodeDetail;
  readonly plays: number;
  readonly mark: ReturnType<typeof useDetailMark>;
  readonly confirm: (value: Confirmation) => void;
  readonly children?: ReactElement;
}): ReactElement {
  const code = epCode(detail.season, detail.number);
  return (
    <RowMenu
      title={detail.title ?? code}
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
    >
      {children}
    </RowMenu>
  );
}
