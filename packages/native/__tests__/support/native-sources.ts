import { readdirSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function nativeSourceFiles(): string[] {
  return [join(__dirname, "../../src"), join(__dirname, "../../app")].flatMap(sourceFiles);
}

// Reached only through the harness entry, which store builds swap out (metro.config.js); the
// ui-harness-behind-its-entry dependency rule keeps every other module from importing them.
const HARNESS_ONLY = ["src/ui/harness.tsx", "src/ui/AppIdle.tsx", "src/ui/perf-channel.ts"].map(
  (file) => join(__dirname, "../..", file),
);

/** The native sources a store build ships. */
export function storeSourceFiles(): string[] {
  return nativeSourceFiles().filter((file) => !HARNESS_ONLY.includes(file));
}
