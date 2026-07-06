import { type Credentials, credentialsSchema } from "@domain/model/credentials";
import { createJsonStore, type JsonStore } from "@platform/json-store";
import type { KeyValueStore } from "@platform/kv";

const CREDS_KEY = "cue.trakt.creds";

/**
 * The user's public Trakt `clientId` + optional TMDB key, stored alongside
 * the token so the auth-code callback can read the client id after a full-page
 * redirect. No client secret is stored — Cue is a public PKCE client.
 */
export type CredsStore = JsonStore<Credentials>;

export function createCredsStore(kv: KeyValueStore): CredsStore {
  return createJsonStore<Credentials>(kv, CREDS_KEY, (value) => credentialsSchema.parse(value));
}
