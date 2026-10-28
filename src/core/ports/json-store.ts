import type { KeyValueStore } from "./kv";

export interface JsonStore<T> {
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
  clear(): Promise<void>;
}

export function createJsonStore<T>(
  kv: KeyValueStore,
  key: string,
  parse: (value: unknown) => T = (value) => value as T,
): JsonStore<T> {
  return {
    async read() {
      const raw = await kv.read(key);
      if (raw === null) return null;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    write: (value) => kv.write(key, JSON.stringify(value)),
    clear: () => kv.remove(key),
  };
}
