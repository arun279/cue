import { spawn } from "node:child_process";
import { expect, it } from "vitest";

// Vitest's forks pool talks to its workers over child_process IPC with
// serialization "advanced". Node before 22.14.0 stops reading that channel when
// a message's 4-byte length header is split across two pipe reads
// (nodejs/node#55834, fixed by #56106), and the waiting worker hangs the run.
// This is Node's own regression test for it, run on the pinned Node.
const SENDER = `
const message = Buffer.allocUnsafe(65521);
let left = 10;
(function send() {
  if (left--) process.send(message, send);
  else process.nextTick(() => process.exit(0));
})();
`;

it("delivers every advanced-serialized IPC message whose length header splits across reads", async () => {
  const child = spawn(process.execPath, ["-e", SENDER], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  let received = 0;
  const all = new Promise<void>((resolve) =>
    child.on("message", () => {
      received += 1;
      if (received === 10) resolve();
    }),
  );
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  child.kill();
  await exited;

  expect(received).toBe(10);
});
