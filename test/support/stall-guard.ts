import type { Reporter, TestModule } from "vitest/node";

// Allow 150 s without a completed file; tests override this with a short bound.
const STALL_MS = Number(process.env["VITEST_STALL_MS"] ?? 150_000);

/**
 * Fails the run when no test file has finished for `STALL_MS` while files are
 * still running, naming them. A test timeout cannot end a file stuck while it
 * loads, which is how a worker can wait forever.
 */
export default class StallGuard implements Reporter {
  readonly #running = new Map<string, string>();
  #timer: NodeJS.Timeout | undefined;

  #arm(): void {
    clearTimeout(this.#timer);
    if (this.#running.size === 0) return;
    this.#timer = setTimeout(() => {
      process.stderr.write(
        `Vitest stalled: no test file finished for ${STALL_MS / 1000} s. Still running:\n${[...this.#running.values()].join("\n")}\n`,
      );
      process.exit(1);
    }, STALL_MS);
    this.#timer.unref();
  }

  onTestModuleQueued(module: TestModule): void {
    this.#running.set(module.moduleId, `${module.project.name}: ${module.relativeModuleId}`);
    this.#arm();
  }

  onTestModuleEnd(module: TestModule): void {
    this.#running.delete(module.moduleId);
    this.#arm();
  }

  onTestRunEnd(): void {
    this.#running.clear();
    clearTimeout(this.#timer);
  }
}
