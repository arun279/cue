/**
 * The OAuth token as Trakt returns it. `created_at`/`expires_in` are unix
 * seconds; expiry math lives in `auth/token.ts`.
 */
export interface Token {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly created_at: number;
  readonly expires_in: number;
  readonly token_type?: string;
  readonly scope?: string;
}
