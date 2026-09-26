/**
 * One string key-value abstraction, injected rather than imported: every
 * backend the app has had is a promise-returning store of strings, and values
 * round-trip byte-identical on all of them. The core writes the op log, the
 * last-activities baseline and the persisted query cache through this and knows
 * nothing about where they land.
 */
export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
