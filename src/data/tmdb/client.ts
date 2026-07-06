import { z } from "zod";
import type { TmdbImageConfig } from "../image-source";
import type { FetchLike } from "../trakt/client";

export const TMDB_API_BASE = "https://api.themoviedb.org/3";

/**
 * In-flight cap. After first paint a screen exposes ~6 not-yet-cached
 * posters at once, so 6 saturates the visible working set without bursting
 * offscreen prefetch, and stays far under TMDB's informal ~40 req/s ceiling.
 */
const DEFAULT_MAX_CONCURRENCY = 6;

export interface TmdbClientConfig {
  /** The v4 Read Access Token (bearer) or the 32-char v3 key; auth is picked by shape. */
  readonly credential: string;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  readonly maxConcurrency?: number;
}

const configurationSchema = z.object({
  images: z.object({ secure_base_url: z.string(), poster_sizes: z.array(z.string()) }),
});

/**
 * TMDB read client. Hits the mature `/3/*` surface with the v4 token as a
 * bearer header (keeps the secret out of URLs/logs) or falls back to
 * `?api_key=` for a v3 key — chosen by credential shape. De-dupes identical
 * in-flight requests and caps concurrency so a poster grid never bursts.
 */
export class TmdbClient {
  private readonly credential: string;
  private readonly authMode: "bearer" | "api_key";
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private readonly maxConcurrency: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(config: TmdbClientConfig) {
    this.credential = config.credential;
    this.authMode = isBearerToken(config.credential) ? "bearer" : "api_key";
    this.fetchFn = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = (config.baseUrl ?? TMDB_API_BASE).replace(/\/+$/, "");
    this.maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  /**
   * GET a `/3/*` path. Identical concurrent calls share one promise (de-dupe);
   * distinct calls queue behind the concurrency cap.
   */
  async get(path: string, query: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const existing = this.inFlight.get(url);
    if (existing !== undefined) return existing;
    const request = this.dispatch(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, request);
    return request;
  }

  /** `/3/configuration` → the image base URL + a poster size for the resolver. */
  async getImageConfig(posterSize = "w342"): Promise<TmdbImageConfig> {
    const parsed = configurationSchema.parse(await this.get("/configuration"));
    const size = parsed.images.poster_sizes.includes(posterSize)
      ? posterSize
      : (parsed.images.poster_sizes.at(-1) ?? posterSize);
    return { secureBaseUrl: parsed.images.secure_base_url, posterSize: size };
  }

  private async dispatch(url: string): Promise<unknown> {
    await this.acquire();
    try {
      const headers: Record<string, string> = {};
      if (this.authMode === "bearer") headers["Authorization"] = `Bearer ${this.credential}`;
      const response = await this.fetchFn(url, { headers });
      return await response.json();
    } finally {
      this.release();
    }
  }

  private buildUrl(path: string, query: Readonly<Record<string, string>>): string {
    const params = new URLSearchParams(query);
    if (this.authMode === "api_key") params.set("api_key", this.credential);
    const suffix = params.toString();
    return suffix.length > 0 ? `${this.baseUrl}${path}?${suffix}` : `${this.baseUrl}${path}`;
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) next();
  }
}

/**
 * The v4 Read Access Token is a JWT (dot-separated, long); the v3 key is a
 * 32-char token with no dots. The dot is the reliable discriminator.
 */
function isBearerToken(credential: string): boolean {
  return credential.includes(".") && credential.length > 40;
}
