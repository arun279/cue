import { formatEpisodeCode } from "@domain/episode";

export interface Health {
  status: "ok";
  sampleCue: string;
}

/**
 * Trivial stand-in for the data layer: proves the domain -> data import edge
 * and gives the shell something real to render. Real Trakt/TMDB repos land later.
 */
export function healthCheck(): Health {
  return { status: "ok", sampleCue: formatEpisodeCode(1, 1) };
}
