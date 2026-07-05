/**
 * Format a season/episode pair as the canonical `S01E02` code used across the
 * Up Next queue. Pure — the domain layer holds logic with no runtime deps.
 */
export function formatEpisodeCode(season: number, episode: number): string {
  const pad = (value: number): string => Math.trunc(value).toString().padStart(2, "0");
  return `S${pad(season)}E${pad(episode)}`;
}
