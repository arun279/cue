import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Points TMPDIR at one directory per run, so every temp file the suites and
 * their subprocesses create lands under it, then fails the run if any process
 * whose command line names that directory outlives the tests, and kills it and
 * its descendants. Killing a spawned script on timeout leaves its own children
 * running. Vitest only logs an error thrown here, hence the exit code.
 */
export default function setup(): () => void {
  const root = mkdtempSync(path.join(tmpdir(), "cue-test-"));
  process.env["TMPDIR"] = root;
  return () => {
    const processes = execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => {
        const [pid = "", ppid = ""] = line.trim().split(/\s+/, 2);
        return { pid, ppid, line: line.trim() };
      });
    const leaked = processes.filter(({ line }) => line.includes(root));
    for (const { pid } of leaked) {
      leaked.push(...processes.filter((child) => child.ppid === pid && !child.line.includes(root)));
    }
    if (leaked.length > 0) {
      console.error(`Tests left processes running:\n${leaked.map(({ line }) => line).join("\n")}`);
      process.exitCode = 1;
    }
    for (const { pid } of leaked) kill(pid);
    rmSync(root, { recursive: true, force: true });
  };
}

function kill(pid: string): void {
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {
    // Already gone: a short-lived child can exit between the listing and the kill.
  }
}
