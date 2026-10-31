import type { LibraryEntry } from "@/core/domain/model/library";
import { agesAgo, entry } from "./up-next";

/** Half the titles started and missing artwork, half never started with a list poster. */
export function largeLibrary(titles: number): LibraryEntry[] {
  return Array.from({ length: titles }, (_, i) =>
    i % 2 === 0
      ? entry({ showId: 10_000 + i, title: `Watching ${i}`, lastWatchedAt: agesAgo(1) })
      : entry({
          showId: 10_000 + i,
          title: `Shelved ${i}`,
          aired: 8,
          completed: 0,
          lastWatchedAt: null,
          nextEpisode: null,
          addedAt: agesAgo(i),
          posters: [`https://walter-r2.trakt.tv/${i}.webp`],
        }),
  );
}
