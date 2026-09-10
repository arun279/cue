import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockTrakt } from "../../../../scripts/mock-trakt/server.mjs";

export function createHarnessServer(prefix: string, journalPath = "journal.ndjson") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const journalFile = join(directory, journalPath);
  const server = createMockTrakt({ port: 0, log: false, journalFile });
  return {
    journalFile,
    listen: () => server.listen(),
    close: async () => {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
