import { expect, it } from "vitest";
import { report, stealPercent } from "../../scripts/android-host.mjs";

const before = "cpu  1000 0 500 8000 100 0 50 0 0 0";
const after = "cpu  1600 0 700 8400 100 0 50 300 120 0";

it("takes CPU steal from the steal column and leaves guest time out of the total", () => {
  expect(stealPercent(before, after)).toBe(20);
  expect(stealPercent(before, before)).toBe(0);
});

it("reports the runner's speed, steal, memory and disk next to the failure", () => {
  const snapshot = {
    cpus: 4,
    model: "AMD EPYC 7763 64-Core Processor",
    kvmWritable: true,
    loadavg: [3.1, 2.4, 1.2],
    cpuLine: before,
    memAvailableMib: 12000,
    memTotalMib: 15990,
    swapUsedMib: 0,
    diskFreeMib: 20480,
    sha256Ms: 610,
  };

  expect(report(snapshot, { ...snapshot, cpuLine: after, sha256Ms: 2400 })).toEqual([
    "Runner: 4 vCPU AMD EPYC 7763 64-Core Processor, /dev/kvm writable",
    "256 MiB SHA-256 took 610 ms before the emulator started and 2400 ms after the run",
    "CPU steal over the run: 20%; load average after the run: 3.1, 2.4, 1.2",
    "Memory available: 12000 MiB before, 12000 MiB after, of 15990 MiB; swap used after: 0 MiB; disk free after: 20480 MiB",
  ]);
});
