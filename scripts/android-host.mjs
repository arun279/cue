import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIB = 1024 * 1024;

/** A fixed CPU workload, so a slow runner shows before the emulator adds time of its own. */
function sha256Ms() {
  const block = Buffer.alloc(16 * MIB);
  const started = performance.now();
  const hash = createHash("sha256");
  for (let i = 0; i < 16; i++) hash.update(block);
  hash.digest();
  return Math.round(performance.now() - started);
}

const meminfoMib = (meminfo, key) =>
  Math.round(
    Number(new RegExp(`^${key}:\\s+(\\d+) kB$`, "m").exec(meminfo)?.[1] ?? Number.NaN) / 1024,
  );

function kvmWritable() {
  try {
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function snapshot() {
  const meminfo = readFileSync("/proc/meminfo", "utf8");
  const disk = statfsSync("/");
  return {
    at: new Date().toISOString(),
    cpus: cpus().length,
    model: cpus()[0]?.model ?? "unknown",
    loadavg: loadavg().map((load) => Number(load.toFixed(2))),
    cpuLine: readFileSync("/proc/stat", "utf8").split("\n")[0],
    memAvailableMib: meminfoMib(meminfo, "MemAvailable"),
    memTotalMib: meminfoMib(meminfo, "MemTotal"),
    swapUsedMib: meminfoMib(meminfo, "SwapTotal") - meminfoMib(meminfo, "SwapFree"),
    diskFreeMib: Math.round((disk.bavail * disk.bsize) / MIB),
    kvmWritable: kvmWritable(),
    sha256Ms: sha256Ms(),
  };
}

/** The share of CPU time the hypervisor gave to other guests between two `/proc/stat` cpu lines. */
export function stealPercent(before, after) {
  const ticks = (line) => line.trim().split(/\s+/).slice(1, 9).map(Number);
  const deltas = ticks(after).map((value, index) => value - (ticks(before)[index] ?? 0));
  const total = deltas.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Number((((deltas[7] ?? 0) / total) * 100).toFixed(1)) : 0;
}

export function report(before, after) {
  return [
    `Runner: ${before.cpus} vCPU ${before.model}, /dev/kvm ${before.kvmWritable ? "writable" : "not writable"}`,
    `256 MiB SHA-256 took ${before.sha256Ms} ms before the emulator started and ${after.sha256Ms} ms after the run`,
    `CPU steal over the run: ${stealPercent(before.cpuLine, after.cpuLine)}%; load average after the run: ${after.loadavg.join(", ")}`,
    `Memory available: ${before.memAvailableMib} MiB before, ${after.memAvailableMib} MiB after, of ${before.memTotalMib} MiB; swap used after: ${after.swapUsedMib} MiB; disk free after: ${after.diskFreeMib} MiB`,
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, first, second] = process.argv.slice(2);
  if (command === "snapshot" && first !== undefined) {
    mkdirSync(path.dirname(first), { recursive: true });
    writeFileSync(first, `${JSON.stringify(snapshot(), null, 2)}\n`);
  } else if (command === "report" && first !== undefined && second !== undefined) {
    const read = (file) => JSON.parse(readFileSync(file, "utf8"));
    process.stdout.write(`${report(read(first), read(second)).join("\n")}\n`);
  } else {
    throw new Error("usage: android-host.mjs snapshot <file> | report <before> <after>");
  }
}
