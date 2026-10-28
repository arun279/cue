import { type ReadProblem, type TraktFailure, TraktReadError } from "../../domain/read-failure";
import { parseReadRetryAfterMs } from "../../domain/write-queue/classify";
import { DEFAULT_TRAKT_POLICY, type TimeoutClass, type TraktPolicy } from "./policy";

const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_API_VERSION = "2";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * fetch without cookies. Trakt authenticates with a bearer token, and on Android React Native's
 * cookie jar loads the system WebView the first time a request uses it.
 */
export const fetchWithoutCookies: FetchLike = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: "omit" });

type Extended = "min" | "full" | "images" | "episodes" | "progress";

export interface TraktClientConfig {
  readonly clientId: string;
  readonly userAgent?: string;
  readonly getToken?: () => string | null;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  readonly policy?: TraktPolicy;
  readonly report?: ReadReporter;
}

interface Pagination {
  readonly page: number;
  readonly pageCount: number;
}

export type ReadReporter = (endpoint: string, problem: ReadProblem) => void;

export type TraktResult<T> =
  | { readonly ok: true; readonly data: T; readonly pagination: Pagination | null }
  | { readonly ok: false; readonly error: TraktFailure };

export function unwrapRead<T>(result: TraktResult<T>, what: string): T {
  if (result.ok) return result.data;
  throw new TraktReadError(result.error, what);
}

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
  readonly timeout?: TimeoutClass;
}

export type HttpMethod = "GET" | "POST";

const DEFAULT_TIMEOUT_CLASS: Readonly<Record<HttpMethod, TimeoutClass>> = {
  GET: "read",
  POST: "write",
};

export class TraktClient {
  readonly policy: TraktPolicy;
  readonly report: ReadReporter;
  private readonly clientId: string;
  private readonly getToken: () => string | null;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private readonly userAgent: string | undefined;

  constructor(config: TraktClientConfig) {
    this.clientId = config.clientId;
    this.getToken = config.getToken ?? (() => null);
    this.fetchFn = config.fetch ?? fetchWithoutCookies;
    this.baseUrl = (config.baseUrl ?? TRAKT_API_BASE).replace(/\/+$/, "");
    this.userAgent = config.userAgent;
    this.policy = config.policy ?? DEFAULT_TRAKT_POLICY;
    this.report = config.report ?? (() => undefined);
  }

  async send(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": TRAKT_API_VERSION,
      "trakt-api-key": this.clientId,
    };
    if (this.userAgent !== undefined) headers["User-Agent"] = this.userAgent;
    const token = this.getToken();
    if (token !== null && token.length > 0) headers["Authorization"] = `Bearer ${token}`;
    const controller = new AbortController();
    const timeoutClass = options.timeout ?? DEFAULT_TIMEOUT_CLASS[method];
    const timeout = setTimeout(() => controller.abort(), this.policy.timeoutMs[timeoutClass]);
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${buildPath(path, options)}`, init);
      return {
        status: response.status,
        headers: headerRecord(response.headers),
        data: await readJson(response),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private rejectionFailure(cause: unknown): TraktFailure {
    return cause instanceof Error && cause.name === "AbortError"
      ? { kind: "timeout" }
      : { kind: "network" };
  }

  async get(path: string, options: RequestOptions = {}): Promise<TraktResult<unknown>> {
    let raw: RawResponse;
    try {
      raw = await this.send("GET", path, options);
    } catch (cause) {
      return { ok: false, error: this.rejectionFailure(cause) };
    }
    if (raw.status === 204) return { ok: false, error: { kind: "no-content" } };
    if (raw.status >= 200 && raw.status < 300) {
      return { ok: true, data: raw.data, pagination: readPagination(raw.headers) };
    }
    return { ok: false, error: mapFailure(raw) };
  }

  // Trakt may apply a smaller page limit than requested.
  async getAllPages(path: string, options: RequestOptions = {}): Promise<TraktResult<unknown[]>> {
    const paged: RequestOptions = { timeout: "list", ...options };
    const first = await this.get(path, { ...paged, page: 1 });
    if (!first.ok) return first;
    const acc = asArray(first.data);
    const pageCount = first.pagination?.pageCount;
    for (let page = 2; pageCount === undefined || page <= pageCount; page += 1) {
      const next = await this.get(path, { ...paged, page });
      if (!next.ok) return next;
      const rows = asArray(next.data);
      if (rows.length === 0) break;
      acc.push(...rows);
    }
    return { ok: true, data: acc, pagination: first.pagination };
  }
}

function mapFailure(raw: RawResponse): TraktFailure {
  if (raw.status === 401) return { kind: "unauthorized" };
  if (raw.status === 404) return { kind: "not-found" };
  if (raw.status === 420) return { kind: "account-limit" };
  if (raw.status === 423) return { kind: "account-locked" };
  if (raw.status === 426) return { kind: "vip-required" };
  if (raw.status === 429) {
    return { kind: "rate-limited", retryAfterMs: parseReadRetryAfterMs(raw.headers, Date.now()) };
  }
  return { kind: "server", status: raw.status };
}

function buildPath(path: string, options: RequestOptions): string {
  const params: string[] = [];
  if (options.extended !== undefined && options.extended.length > 0) {
    params.push(`extended=${encodeURIComponent(options.extended.join(","))}`);
  }
  if (options.page !== undefined) params.push(`page=${options.page}`);
  if (options.limit !== undefined) params.push(`limit=${options.limit}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  const query = params.join("&");
  return query.length > 0 ? `${path}?${query}` : path;
}

function readPagination(headers: Readonly<Record<string, string>>): Pagination | null {
  const page = numberHeader(headers, "x-pagination-page");
  const pageCount = numberHeader(headers, "x-pagination-page-count");
  if (page === null || pageCount === null) return null;
  return { page, pageCount };
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
