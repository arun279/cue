import { z } from "zod";

/**
 * The OAuth token as Trakt returns it. `created_at`/`expires_in` are unix
 * seconds; expiry math lives in `auth/token.ts`. The schema is the single
 * source of truth: the token store validates persisted JSON against it and the
 * OAuth client parses network responses with it.
 */
export const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  created_at: z.number(),
  expires_in: z.number(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export interface Token {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly created_at: number;
  readonly expires_in: number;
  readonly token_type?: string;
  readonly scope?: string;
}
