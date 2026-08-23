/**
 * Trakt id blocks. Any single id resolves an item on a `/sync/*` write body;
 * `trakt` is the primary key everything else joins on.
 */
export interface ShowIds {
  readonly trakt: number;
  readonly slug?: string;
  readonly tvdb?: number;
  readonly imdb?: string;
  readonly tmdb?: number;
}

export interface EpisodeIds {
  readonly trakt: number;
  readonly tvdb?: number;
  readonly imdb?: string;
  readonly tmdb?: number;
}

export interface MovieIds {
  readonly trakt: number;
  readonly slug?: string;
  readonly imdb?: string;
  readonly tmdb?: number;
}
