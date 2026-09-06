import { type Token, tokenSchema } from "../domain/model/token";
import { createJsonStore, type JsonStore } from "./json-store";
import type { KeyValueStore } from "./kv";

const TOKEN_KEY = "cue.trakt.token";

/** The Trakt OAuth token behind the platform key-value abstraction. */
export type TokenStore = JsonStore<Token>;

export function createTokenStore(kv: KeyValueStore): TokenStore {
  return createJsonStore<Token>(kv, TOKEN_KEY, (value) => tokenSchema.parse(value));
}
