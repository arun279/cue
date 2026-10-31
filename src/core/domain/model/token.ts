import { z } from "zod";

// Trakt sends created_at and expires_in as unix seconds.
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
