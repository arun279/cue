import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYBACK_PREDICATE } from "../../scripts/simulator-touch.mjs";
import { startReadyProcess } from "../../scripts/start-ready-process.mjs";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

afterEach(() => vi.unstubAllEnvs());

describe("maestro-runner.mjs", () => {
  const bind = (port: number) =>
    new Promise<ReturnType<typeof createServer> | undefined>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(undefined));
      server.listen(port, "127.0.0.1", () => resolve(server));
    });
  const close = (server?: ReturnType<typeof createServer>) =>
    new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  /** A free port for the proxy whose next port is free for the runner. */
  const freePorts = async (): Promise<number> => {
    for (;;) {
      const first = await bind(0);
      const { port } = first?.address() as { port: number };
      const second = await bind(port + 1);
      await Promise.all([close(first), close(second)]);
      if (second !== undefined) return port;
    }
  };

  const xcodebuild = (source: string) =>
    fakeBin({ xcodebuild: `#!${process.execPath}\n${source}` });
  const answering = xcodebuild(`
const fs = require("node:fs");
fs.writeFileSync(process.env.PROBE_CALLS, JSON.stringify({ args: process.argv.slice(2), port: process.env.TEST_RUNNER_PORT }));
let requests = 0;
require("node:http").createServer((request, response) => {
  requests += 1;
  response.statusCode = request.method === "POST" && request.url === "/deviceInfo" && requests > 1 ? 200 : 500;
  response.end();
}).listen(Number(process.env.TEST_RUNNER_PORT), "127.0.0.1");
`);
  const failing = xcodebuild('console.error("Testing failed"); process.exit(65);');
  const logStream = fakeBin({
    xcrun: `#!${process.execPath}
if (process.argv.length > 2) {
  require("node:fs").writeFileSync(process.env.STREAM_CALLS, JSON.stringify(process.argv.slice(2)));
  console.log('Filtering the log data using "..."');
  setInterval(() => {}, 1000);
}
`,
  });

  const start = async (bin: string) => {
    const root = tempDirectory("cue-runner-start-");
    vi.stubEnv("PATH", `${bin}:${logStream}:${process.env["PATH"]}`);
    vi.stubEnv("DEVICE_ID", "test-device");
    vi.stubEnv("MAESTRO_RUNNER_PORT", String(await freePorts()));
    vi.stubEnv("RUNNER_TEMP", root);
    vi.stubEnv("PROBE_CALLS", path.join(root, "calls"));
    vi.stubEnv("STREAM_CALLS", path.join(root, "stream"));
    const log = path.join(root, "runner.log");
    return {
      root,
      log,
      ready: startReadyProcess(repositoryPath("scripts/maestro-runner.mjs"), log, 10_000),
    };
  };

  it("runs the server test on the booted device behind the tap proxy and waits for deviceInfo to answer 200", async () => {
    const { root, log, ready } = await start(answering);
    const pid = await ready;
    process.kill(-pid, "SIGKILL");

    expect(JSON.parse(readFileSync(path.join(root, "calls"), "utf8"))).toEqual({
      args: [
        "test-without-building",
        "-xctestrun",
        `${root}/maestro-runner/maestro-driver-ios.xctestrun`,
        "-destination",
        "id=test-device",
        "-only-testing:maestro-driver-iosUITests/maestro_driver_iosUITests",
      ],
      port: String(Number(process.env["MAESTRO_RUNNER_PORT"]) + 1),
    });
    expect(JSON.parse(readFileSync(path.join(root, "stream"), "utf8"))).toEqual([
      "simctl",
      "spawn",
      "test-device",
      "log",
      "stream",
      "--style",
      "ndjson",
      "--predicate",
      PLAYBACK_PREDICATE,
    ]);
    expect(readFileSync(log, "utf8")).toBe(
      "deviceInfo: 500\ndeviceInfo: 200\ndeviceInfo through the tap proxy: 200\n",
    );
  });

  it("reports the runner exiting before it answers", async () => {
    const { ready } = await start(failing);

    await expect(ready).rejects.toThrow(/Process exited before readiness: 65[\s\S]*Testing failed/);
  });
});
