import { epCode } from "./model/library";

export function detailDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function sheetMetaLine(episode: {
  readonly season: number;
  readonly number: number;
  readonly aired: boolean;
  readonly firstAired: string | null;
  readonly runtime: number | null;
}): string {
  return [
    epCode(episode.season, episode.number),
    episode.aired && episode.firstAired !== null ? `Aired ${detailDate(episode.firstAired)}` : null,
    episode.runtime === null ? null : `${episode.runtime} min`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export function episodeStatus(watched: boolean, watchedAt: string | null, plays: number): string {
  if (!watched) return "Not watched yet";
  if (plays === 2) return "Watched twice";
  if (plays > 2) return `Watched ${plays} times`;
  return watchedAt === null ? "Watched" : `Watched ${detailDate(watchedAt)}`;
}

export function airsLine(iso: string): string {
  const date = new Date(iso);
  return `Airs ${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "")} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
