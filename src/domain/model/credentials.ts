import { z } from "zod";

/**
 * The user-supplied Trakt app credentials plus the optional TMDB key
 * Zero-backend and a public client: Cue authenticates with
 * OAuth PKCE, so only the public `clientId` is stored — there is no client
 * secret. `tmdbKey` is empty when the optional image upgrade is not configured.
 * The schema guards the creds store against partial/wrong-shaped persisted JSON.
 */
export const credentialsSchema = z.object({
  clientId: z.string(),
  tmdbKey: z.string(),
});

export interface Credentials {
  readonly clientId: string;
  readonly tmdbKey: string;
}
