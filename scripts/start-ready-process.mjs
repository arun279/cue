import { fork } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function startReadyProcess(module, log, timeoutMs = 30_000) {
  const output = openSync(log, "w");
  const child = fork(module, [], { detached: true, stdio: ["ignore", output, output, "ipc"] });
  closeSync(output);
  return new Promise((resolve, reject) => {
    const fail = (reason) => {
      clearTimeout(watchdog);
      child.removeListener("exit", exited);
      child.removeListener("error", fail);
      child.removeAllListeners("message");
      child.kill("SIGKILL");
      reject(new Error(`${reason}\n${log}\n${readFileSync(log, "utf8")}`));
    };
    const exited = (code, signal) => fail(`Process exited before readiness: ${code ?? signal}`);
    const watchdog = setTimeout(() => fail("Readiness watchdog expired"), timeoutMs);
    child.once("error", fail);
    child.once("exit", exited);
    child.once("message", (message) => {
      if (!message.ready) return fail("Invalid readiness signal");
      clearTimeout(watchdog);
      child.removeListener("exit", exited);
      child.removeListener("error", fail);
      child.disconnect();
      child.unref();
      resolve(child.pid);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${await startReadyProcess(process.argv[2], process.argv[3])}\n`);
}
