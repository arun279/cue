import { vi } from "vitest";

/** Shared `@capacitor/preferences` mock module, backed by a plain Map the caller owns. */
export function createPreferencesMock(backing: Map<string, string>) {
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: backing.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        backing.set(key, value);
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        backing.delete(key);
      }),
    },
  };
}
