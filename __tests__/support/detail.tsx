import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { EpisodeDetail } from "@/core/domain/episode-detail";
import type { SeasonView } from "@/core/domain/show-detail";
import type { PreferenceStorage } from "@/core/ports/preference-storage";
import {
  episodeQuery,
  showInfoQuery,
  showProgressQuery,
  showSeasonsQuery,
} from "@/core/queries/shows";
import type { CueRuntime } from "@/core/runtime/runtime";
import type { ShowHeader } from "../../src/screens/show-detail/useShowDetail";
import { agesAgo, fakeRuntime, Harness, spyHaptics } from "./up-next";

export const detail: EpisodeDetail = {
  showId: 8803,
  season: 2,
  number: 3,
  title: "Salt Air",
  overview: "The station stays on the air.",
  firstAired: agesAgo(2),
  runtime: 58,
  ids: { trakt: 880308 },
  stills: ["https://example.com/still.jpg"],
  aired: true,
  watched: false,
  watchedAt: null,
  prev: { season: 2, number: 2 },
  next: { season: 2, number: 4 },
};

export function detailSeason(number = 2): SeasonView {
  return {
    number,
    title: null,
    isSpecial: number === 0,
    isHidden: false,
    airedCount: 4,
    completedCount: 2,
    episodes: [1, 2, 3, 4].map((episode) => ({
      ...detail,
      season: number,
      number: episode,
      ids: { trakt: 880300 + number * 10 + episode },
      watched: episode < 3,
    })),
  };
}

export const header: ShowHeader = {
  ids: { trakt: 8803 },
  title: "Midnight Cartography",
  year: 2023,
  status: "returning series",
  network: "Tessellate",
  genres: ["thriller"],
  runtime: 58,
  overview: "A pair of mapmakers find a road.",
  posters: [],
  backdrops: [],
  aired: 10,
  completed: 8,
  lastWatchedAt: null,
  left: 2,
  nextEpisode: detail,
  lastAired: { season: 2, number: 4 },
};

export const detailRuntime = {
  ...fakeRuntime({ submit: () => Promise.resolve("deferred") }),
  loadShowRelated: jest.fn(async () => []),
  loadShowInfo: jest.fn(async () => header),
  loadShowProgress: jest.fn(async () => header),
  loadShowSeasons: jest.fn(async () => [detailSeason(0), detailSeason(1), detailSeason(2)]),
  loadEpisode: jest.fn(async () => detail),
  loadMovieWatchlist: jest.fn(async () => []),
};

function seedDetail(client: QueryClient): void {
  client.setQueryData(showInfoQuery(detailRuntime, 8803).queryKey, header);
  client.setQueryData(showProgressQuery(detailRuntime, 8803).queryKey, header);
  client.setQueryData(showSeasonsQuery(detailRuntime, 8803).queryKey, [
    detailSeason(0),
    detailSeason(1),
    detailSeason(2),
  ]);
  client.setQueryData(episodeQuery(detailRuntime, 8803, 2, 3).queryKey, detail);
}

const haptics = spyHaptics();
export function DetailHarness({
  children,
  runtime = detailRuntime,
  preferences,
}: {
  readonly children: ReactNode;
  readonly runtime?: CueRuntime;
  readonly preferences?: PreferenceStorage;
}): ReactElement {
  return (
    <Harness runtime={runtime} haptics={haptics} preferences={preferences} seed={seedDetail}>
      {children}
    </Harness>
  );
}

export function imageModule() {
  return { Image: require("react-native").Image };
}
