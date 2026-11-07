export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface BatchKeyValueStore extends KeyValueStore {
  /** Writes every entry, or none of them. */
  writeAll(entries: Readonly<Record<string, string>>): Promise<void>;
}
