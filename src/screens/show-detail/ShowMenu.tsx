import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { SeasonView } from "@/core/domain/show-detail";
import { earlierUnwatchedCount, episodeCount } from "@/core/domain/show-detail";
import { useAlertsMute } from "@/core/hooks/useAlertsMute";
import { useHideShow } from "@/core/hooks/useHideShow";
import { useMoveToWatchlist } from "@/core/hooks/useMoveToWatchlist";
import { showSnack } from "@/core/stores/snackbar-store";
import { confirm } from "../../ui/confirm";
import { HeaderMenu } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import type { useDetailMark } from "./useDetailMark";
import type { ShowHeader } from "./useShowDetail";

export function ShowMenu({
  header,
  entry,
  seasons,
  mark,
}: {
  readonly header: ShowHeader;
  readonly entry: LibraryEntry;
  readonly seasons: readonly SeasonView[];
  readonly mark: ReturnType<typeof useDetailMark>;
}): ReactElement {
  const hide = useHideShow();
  const moveToWatchlist = useMoveToWatchlist();
  const alerts = useAlertsMute(entry.showId, header.title);
  const remaining = earlierUnwatchedCount(seasons, {
    season: Number.MAX_SAFE_INTEGER,
    number: Number.MAX_SAFE_INTEGER,
  });
  return (
    <HeaderMenu
      title={header.title}
      testID={TEST_IDS.showDetailMore}
      items={[
        {
          id: "mark-show",
          label: "Mark whole show watched",
          available: remaining > 0,
          onPress: () =>
            confirm({
              title: "Mark whole show watched?",
              message: `${episodeCount(remaining)} will be added to your history.`,
              primary: `Mark ${episodeCount(remaining)}`,
              onPrimary: () =>
                void mark.controller.markUpToHere(
                  { ...mark.target, includeSpecials: false },
                  seasons.filter((season) => !season.isHidden),
                  { season: Number.MAX_SAFE_INTEGER, number: Number.MAX_SAFE_INTEGER },
                ),
            }),
        },
        {
          id: "resume",
          label: "Resume watching",
          available: entry.hidden,
          onPress: () => void hide.unhide(entry.showId, header.ids, header.title),
        },
        {
          id: "watchlist",
          label: "Move to Watchlist",
          available: entry.completed === 0 && !entry.inWatchlist,
          onPress: () => void moveToWatchlist(entry),
        },
        {
          id: "trakt",
          label: "Open on Trakt",
          image:
            Platform.OS === "ios" ? "arrow.up.right.square" : require("../../ui/open-in-new.xml"),
          onPress: () => {
            void WebBrowser.openBrowserAsync(
              `https://trakt.tv/shows/${header.ids.slug ?? header.ids.trakt}`,
            ).catch(() => showSnack({ message: "Couldn't open Trakt. Please try again." }));
          },
        },
        { id: "mute-alerts", label: alerts.label, onPress: alerts.toggle },
        {
          id: "stop",
          label: "Stop watching",
          available: !entry.hidden,
          destructive: true,
          onPress: () =>
            confirm({
              title: header.title,
              message: "Stopping keeps your watch history.",
              primary: "Stop show",
              onPrimary: () => void hide.hide(entry.showId, header.ids, header.title),
            }),
        },
      ]}
    />
  );
}
