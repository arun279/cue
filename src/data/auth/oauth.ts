import { type Token, tokenSchema } from "@domain/model/token";
import { z } from "zod";
import type { FetchLike } from "../trakt/client";

/**
 * Client-side OAuth against Trakt. The user-facing
 * `authorize`/`activate` pages live on `trakt.tv`; the token/device/revoke
 * endpoints on `api.trakt.tv`. Trakt allows CORS on `/oauth/token`, so the
 * code→token exchange runs directly in the browser — no backend.
 */
const TRAKT_SITE_BASE = "https://trakt.tv";
export const TRAKT_API_BASE = "https://api.trakt.tv";

export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
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
}

/** Terminal + transient outcomes of one device-token poll. */
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
): Promise<{ status: number; data: unknown }> {
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
  return { status: response.status, data };
}

/** The full-page redirect target that starts the web auth-code flow. */
export function buildAuthorizeUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${siteBase(config)}/oauth/authorize?${params.toString()}`;
}

/** Exchange the returned `code` for a token; throws on a non-2xx or malformed body. */
export async function exchangeCodeForToken(config: OAuthConfig, code: string): Promise<Token> {
  const { status, data } = await postJson(config, "/oauth/token", {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (status < 200 || status >= 300) throw new Error(`Trakt token exchange failed (${status}).`);
  return tokenSchema.parse(data);
}

/** Rotate a token via its `refresh_token`; the refresher calls this. */
export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<Token> {
  const { status, data } = await postJson(config, "/oauth/token", {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "refresh_token",
  });
  if (status < 200 || status >= 300) throw new Error(`Trakt token refresh failed (${status}).`);
  return tokenSchema.parse(data);
}

/** Revoke the access token on sign-out; best-effort, resolves regardless of body. */
export async function revokeToken(config: OAuthConfig, accessToken: string): Promise<void> {
  await postJson(config, "/oauth/revoke", {
    token: accessToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
}

/** Start the device-code flow: returns the code to display + the poll interval. */
export async function requestDeviceCode(config: OAuthConfig): Promise<DeviceCode> {
  const { status, data } = await postJson(config, "/oauth/device/code", {
    client_id: config.clientId,
  });
  if (status < 200 || status >= 300)
    throw new Error(`Trakt device-code request failed (${status}).`);
  const parsed = deviceCodeSchema.parse(data);
  return {
    deviceCode: parsed.device_code,
    userCode: parsed.user_code,
    verificationUrl: parsed.verification_url,
    intervalMs: parsed.interval * 1000,
  };
}

/**
 * One device-token poll. 200 = authorized; 400 = still pending; 429 = slow
 * down; 418 = denied; 410 = expired; anything else is a hard error. The loop +
 * timing lives in the UI controller (gated by the hermetic e2e suite).
 */
export async function pollDeviceToken(
  config: OAuthConfig,
  deviceCode: string,
): Promise<DeviceTokenResult> {
  const { status, data } = await postJson(config, "/oauth/device/token", {
    code: deviceCode,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (status >= 200 && status < 300) return { status: "success", token: tokenSchema.parse(data) };
  if (status === 400) return { status: "pending" };
  if (status === 429) return { status: "slow-down" };
  if (status === 418) return { status: "denied" };
  if (status === 410) return { status: "expired" };
  return { status: "error", code: status };
}
