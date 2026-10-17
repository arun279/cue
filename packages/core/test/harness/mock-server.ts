import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockTrakt } from "../../../../scripts/mock-trakt/server.mjs";

interface RequestEntry {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: Record<string, unknown>;
}

export function createHarnessServer(prefix: string, journalPath = "journal.ndjson") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const journalFile = join(directory, journalPath);
  const waiting = new Set<{
    readonly matches: (entry: RequestEntry) => boolean;
    readonly resolve: (entry: RequestEntry) => void;
  }>();
  const server = createMockTrakt({
    port: 0,
    log: false,
    journalFile,
    onRequest: (entry: RequestEntry) => {
      for (const waiter of waiting) {
        if (!waiter.matches(entry)) continue;
        waiting.delete(waiter);
        waiter.resolve(entry);
      }
    },
  });
  return {
    journalFile,
    listen: () => server.listen(),
    nextRequest: (matches: (entry: RequestEntry) => boolean): Promise<RequestEntry> =>
      new Promise((resolve) => waiting.add({ matches, resolve })),
    close: async () => {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
