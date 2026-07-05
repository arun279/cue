import { z } from "zod";

/**
 * The user-supplied Trakt app credentials plus the optional TMDB key
 * Zero-backend: the user registers their own single-owner
 * Trakt app, so `clientSecret` is local — not a confidential client secret.
 * `tmdbKey` is empty when the optional image upgrade is not configured. The
 * schema guards the creds store against partial/wrong-shaped persisted JSON.
 */
export const credentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  tmdbKey: z.string(),
});

export interface Credentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tmdbKey: string;
}
