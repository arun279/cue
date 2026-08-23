import type { KeyValueStore } from "@platform/kv";

/**
 * A single JSON value behind the platform key-value abstraction.
 * Serialized as JSON so it round-trips on either backend; a corrupt/absent
 * entry reads back as `null` rather than throwing. The token store is an instance
 * of this shape. An optional `parse` validates the decoded JSON so a
 * partial/wrong-shaped entry also reads back as `null`.
 */
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
