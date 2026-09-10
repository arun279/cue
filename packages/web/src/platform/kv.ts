import type { KeyValueStore } from "@cue/core/ports/kv";
import { del, get, set } from "idb-keyval";

export function createKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      return (await get<string>(key)) ?? null;
    },
    write: (key, value) => set(key, value),
    remove: (key) => del(key),
  };
}
