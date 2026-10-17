import { z } from "zod";
import { type Token, tokenSchema } from "../../domain/model/token";
import { parseRetryAfterMs } from "../../domain/write-queue/classify";
import type { FetchLike } from "../trakt/client";

const TRAKT_SITE_BASE = "https://trakt.tv";
export const TRAKT_API_BASE = "https://api.trakt.tv";

export interface OAuthConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly fetch?: FetchLike;
  readonly apiBaseUrl?: string;
  readonly siteBaseUrl?: string;
}

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_url: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly intervalMs: number;
  readonly expiresInMs: number;
}

export type DeviceTokenResult =
  | { readonly status: "success"; readonly token: Token }
  | { readonly status: "pending" }
  | { readonly status: "slow-down" }
  | { readonly status: "denied" }
  | { readonly status: "expired" }
  | { readonly status: "error"; readonly code: number };

function fetchFn(config: OAuthConfig): FetchLike {
  return config.fetch ?? ((input, init) => globalThis.fetch(input, init));
}

function apiBase(config: OAuthConfig): string {
  return (config.apiBaseUrl ?? TRAKT_API_BASE).replace(/\/+$/, "");
}

function siteBase(config: OAuthConfig): string {
  return (config.siteBaseUrl ?? TRAKT_SITE_BASE).replace(/\/+$/, "");
}

async function postJson(
  config: OAuthConfig,
  path: string,
  body: Record<string, string>,
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const response = await fetchFn(config)(`${apiBase(config)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data, headers: response.headers };
}

export function buildAuthorizeUrl(
  config: OAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const params = [
    ["response_type", "code"],
    ["client_id", config.clientId],
    ["redirect_uri", config.redirectUri],
    ["state", state],
    ["code_challenge", codeChallenge],
    ["code_challenge_method", "S256"],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`)
    .join("&");
  return `${siteBase(config)}/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<Token> {
  const { status, data } = await postJson(config, "/oauth/token", {
    code,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
  });
  if (status < 200 || status >= 300) throw new Error(`Trakt token exchange failed (${status}).`);
  return tokenSchema.parse(data);
}

export class TokenRefreshError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly code: string | null;

  constructor(status: number, retryAfterMs: number | null, code: string | null) {
    super(`Trakt token refresh failed (${status}).`);
    this.name = "TokenRefreshError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<Token> {
  const { status, data, headers } = await postJson(config, "/oauth/token", {
    refresh_token: refreshToken,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    grant_type: "refresh_token",
  });
  if (status < 200 || status >= 300) {
    const retryAfterMs = parseRetryAfterMs(headerRecord(headers), Date.now());
    throw new TokenRefreshError(status, retryAfterMs, oauthErrorCode(data));
  }
  return tokenSchema.parse(data);
}

function oauthErrorCode(data: unknown): string | null {
  if (data === null || typeof data !== "object" || !("error" in data)) return null;
  const code = (data as { error: unknown }).error;
  return typeof code === "string" ? code : null;
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

// Trakt documents client_secret as required here (https://docs.trakt.tv/reference/postoauthrevoke); a PKCE client has none to send.
export async function revokeToken(config: OAuthConfig, accessToken: string): Promise<void> {
  await postJson(config, "/oauth/revoke", {
    token: accessToken,
    client_id: config.clientId,
  });
}

export async function requestDeviceCode(
  config: OAuthConfig,
  codeChallenge: string,
): Promise<DeviceCode> {
  const { status, data } = await postJson(config, "/oauth/device/code", {
    client_id: config.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (status < 200 || status >= 300)
    throw new Error(`Trakt device-code request failed (${status}).`);
  const parsed = deviceCodeSchema.parse(data);
  return {
    deviceCode: parsed.device_code,
    userCode: parsed.user_code,
    verificationUrl: parsed.verification_url,
    intervalMs: parsed.interval * 1000,
    expiresInMs: parsed.expires_in * 1000,
  };
}

export async function pollDeviceToken(
  config: OAuthConfig,
  deviceCode: string,
  codeVerifier: string,
): Promise<DeviceTokenResult> {
  const { status, data } = await postJson(config, "/oauth/device/token", {
    code: deviceCode,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  if (status >= 200 && status < 300) return { status: "success", token: tokenSchema.parse(data) };
  if (status === 400) return { status: "pending" };
  if (status === 429) return { status: "slow-down" };
  if (status === 418) return { status: "denied" };
  if (status === 410) return { status: "expired" };
  return { status: "error", code: status };
}
