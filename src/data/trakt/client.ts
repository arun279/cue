import { parseRetryAfterMs } from "@domain/write-queue/classify";

export const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_API_VERSION = "2";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** `extended` richness levels, comma-combined into the query. */
type Extended = "min" | "full" | "images" | "episodes";

export interface TraktClientConfig {
  readonly clientId: string;
  /** Bearer token for authed calls; absent → the header is omitted. */
  readonly getToken?: () => string | null;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

/** Parsed `X-Pagination-*` headers; `null` when the endpoint sends none. */
interface Pagination {
  readonly page: number;
  readonly limit: number;
  readonly pageCount: number;
  readonly itemCount: number;
}

/**
 * The typed transport failures. A `network` reject is the ambiguous class
 * the write queue reconciles before retry; any non-2xx we do not model
 * specifically (an unexpected 4xx) surfaces as `server` carrying its status, so
 * the union stays closed and every failure is readable.
 */
export type TraktFailure =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not-found" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number | null }
  | { readonly kind: "server"; readonly status: number }
  | { readonly kind: "network" };

export type TraktResult<T> =
  | { readonly ok: true; readonly data: T; readonly pagination: Pagination | null }
  | { readonly ok: false; readonly error: TraktFailure };

/** Raw response the write-queue transport needs; a fetch reject throws (network). */
export interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: unknown;
}

export interface RequestOptions {
  readonly extended?: readonly Extended[];
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: unknown;
  readonly page?: number;
  readonly limit?: number;
}

export type HttpMethod = "GET" | "POST";

/**
 * Typed Trakt fetch. Sets the required headers, builds the `extended`
 * param, exposes pagination, and maps status → a closed `TraktResult` union.
 * Never throws across the boundary except when a body is unparseable JSON — the
 * schema layer (`endpoints.ts`) turns a wrong-shape body into a throw via zod.
 */
export class TraktClient {
  private readonly clientId: string;
  private readonly getToken: () => string | null;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;

  constructor(config: TraktClientConfig) {
    this.clientId = config.clientId;
    this.getToken = config.getToken ?? (() => null);
    this.fetchFn = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = (config.baseUrl ?? TRAKT_API_BASE).replace(/\/+$/, "");
  }

  /** Low-level send used by the write-queue transport: raw response, throws on network reject. */
  async send(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": TRAKT_API_VERSION,
      "trakt-api-key": this.clientId,
    };
    const token = this.getToken();
    if (token !== null && token.length > 0) headers["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const response = await this.fetchFn(`${this.baseUrl}${buildPath(path, options)}`, init);
    return {
      status: response.status,
      headers: headerRecord(response.headers),
      data: await readJson(response),
    };
  }

  async get(path: string, options: RequestOptions = {}): Promise<TraktResult<unknown>> {
    return this.request("GET", path, options);
  }

  async post(path: string, body: unknown): Promise<TraktResult<unknown>> {
    return this.request("POST", path, { body });
  }

  private async request(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<TraktResult<unknown>> {
    let raw: RawResponse;
    try {
      raw = await this.send(method, path, options);
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
    if (raw.status >= 200 && raw.status < 300) {
      return { ok: true, data: raw.data, pagination: readPagination(raw.headers) };
    }
    return { ok: false, error: mapFailure(raw) };
  }

  /**
   * Walk every page of a list endpoint via `X-Pagination-Page-Count`, flattening
   * into one array — the initial library snapshot helper. Endpoints without
   * pagination headers resolve as a single page.
   */
  async getAllPages(path: string, options: RequestOptions = {}): Promise<TraktResult<unknown[]>> {
    const first = await this.get(path, { ...options, page: 1 });
    if (!first.ok) return first;
    const acc = asArray(first.data);
    const pageCount = first.pagination?.pageCount ?? 1;
    for (let page = 2; page <= pageCount; page += 1) {
      const next = await this.get(path, { ...options, page });
      if (!next.ok) return next;
      acc.push(...asArray(next.data));
    }
    return { ok: true, data: acc, pagination: first.pagination };
  }
}

function mapFailure(raw: RawResponse): TraktFailure {
  if (raw.status === 401) return { kind: "unauthorized" };
  if (raw.status === 404) return { kind: "not-found" };
  if (raw.status === 429) {
    return { kind: "rate-limited", retryAfterMs: parseRetryAfterMs(raw.headers, Date.now()) };
  }
  return { kind: "server", status: raw.status };
}

function buildPath(path: string, options: RequestOptions): string {
  const params = new URLSearchParams();
  if (options.extended !== undefined && options.extended.length > 0) {
    params.set("extended", options.extended.join(","));
  }
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  for (const [key, value] of Object.entries(options.query ?? {})) params.set(key, String(value));
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

function readPagination(headers: Readonly<Record<string, string>>): Pagination | null {
  const page = numberHeader(headers, "x-pagination-page");
  const pageCount = numberHeader(headers, "x-pagination-page-count");
  if (page === null || pageCount === null) return null;
  return {
    page,
    pageCount,
    limit: numberHeader(headers, "x-pagination-limit") ?? 0,
    itemCount: numberHeader(headers, "x-pagination-item-count") ?? 0,
  };
}

function numberHeader(headers: Readonly<Record<string, string>>, name: string): number | null {
  const raw = headers[name];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function asArray(data: unknown): unknown[] {
  return Array.isArray(data) ? [...data] : [];
}
