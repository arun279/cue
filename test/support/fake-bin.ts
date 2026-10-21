import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * A directory of stand-in commands to put first on PATH, written once for the
 * whole test file and run once here, with no arguments or environment, before
 * any case starts. Each case steers them through environment variables.
 *
 * macOS checks every newly written executable the first time it runs, and those
 * checks run one at a time across the machine: about 0.2 s each when idle and
 * seconds behind other test workers. Fakes written per case paid that inside
 * every case's timeout, which is what made subprocess tests time out under load.
 */
export function fakeBin(commands: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "cue-fake-bin-"));
  afterAll(() => rmSync(directory, { recursive: true }));
  for (const [name, script] of Object.entries(commands)) {
    const command = path.join(directory, name);
    writeFileSync(command, script, { mode: 0o755 });
    spawnSync(command, { env: {}, stdio: "ignore" });
  }
  return directory;
}
