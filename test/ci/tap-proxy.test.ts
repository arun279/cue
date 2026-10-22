import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { provenCancels } from "../../scripts/simulator-touch.mjs";
import { createTapProxy, playbackWindows } from "../../scripts/tap-proxy.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const fixture = (name: string) =>
  readFileSync(repositoryPath(`test/ci/fixtures/simulator-touch/${name}`), "utf8")
    .trim()
    .split("\n");

const frame = { X: 0, Y: 0, Width: 402, Height: 874 };
const done = { label: "Done", value: null, frame: { X: 317, Y: 66, Width: 65, Height: 36 } };
const tvShows = { label: "TV shows", value: "1", frame: { X: 323, Y: 266, Width: 63, Height: 28 } };
const tree = (control: object) => ({
  axElement: { label: "", frame, children: [control] },
  depth: 2,
});

afterEach(() => vi.unstubAllEnvs());

/** A stand-in runner that answers hierarchies in turn and counts taps. */
async function runner(hierarchies: object[]) {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    request.resume();
    request.on("end", () => {
      const body = request.url === "/viewHierarchy" ? JSON.stringify(hierarchies.shift()) : "{}";
      response.writeHead(200, { "content-type": "application/json" }).end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, calls, close: () => server.close() };
}

async function tapThroughProxy(
  log: string[] | undefined,
  before: object,
  after: object,
  point: object,
) {
  vi.stubEnv("RUNNER_TEMP", tempDirectory("cue-tap-proxy-"));
  const fake = await runner([before, after]);
  const proxy = createTapProxy({ runner: fake.url, playback: { window: async () => log } });
  const origin = `http://127.0.0.1:${await proxy.listen(0)}`;
  try {
    const post = (route: string, body: object) =>
      fetch(`${origin}${route}`, { method: "POST", body: JSON.stringify(body) });
    const hierarchy = await (
      await post("/viewHierarchy", { appIds: [], excludeKeyboardElements: false })
    ).json();
    expect(hierarchy).toEqual(before);
    expect((await post("/touch", point)).status).toBe(200);
    return fake.calls;
  } finally {
    await proxy.close();
    fake.close();
  }
}

it("taps the Profile sheet's Done again when the simulator cancelled it and it is still there", async () => {
  const calls = await tapThroughProxy(fixture("done-dropped.txt"), tree(done), tree(done), {
    x: 349,
    y: 84,
  });

  expect(calls).toEqual([
    "POST /viewHierarchy",
    "POST /touch",
    "POST /viewHierarchy",
    "POST /touch",
  ]);
  expect(provenCancels()).toEqual([expect.stringContaining("canceling paths")]);
});

it.each([
  [
    "a tap the simulator delivered",
    fixture("done-normal.txt"),
    tree(done),
    tree(done),
    { x: 349, y: 84 },
    1,
  ],
  [
    "a cancelled tap whose switch toggled",
    fixture("switch-dropped.txt"),
    tree(tvShows),
    tree({ ...tvShows, value: "0" }),
    { x: 354, y: 280 },
    2,
  ],
  ["a tap with no playback in the log", undefined, tree(done), tree(done), { x: 349, y: 84 }, 1],
])("passes %s through once, reading the hierarchy again only after a cancel", async (_, log, before, after, point, reads) => {
  const calls = await tapThroughProxy(log, before, after, point);

  expect(calls.filter((call) => call === "POST /touch")).toHaveLength(1);
  expect(calls.filter((call) => call === "POST /viewHierarchy")).toHaveLength(reads);
  expect(provenCancels()).toEqual([]);
});

const ndjson = (line: string) => {
  const [, date, time, process, message] =
    /^(\S+) (\S+)\s+localhost (\w+)\[\d+\]: (?:\[[^\]]*\] )?(.*)$/.exec(line) ?? [];
  return JSON.stringify({
    timestamp: `${date} ${time}`,
    processImagePath: `/usr/bin/${process}`,
    eventMessage: message,
  });
};

it("answers one tap's playback, from its start through its completion, as the log arrives", async () => {
  const lines = new EventEmitter();
  const windows = playbackWindows(lines);
  for (const line of fixture("switch-dropped.txt")) lines.emit("line", ndjson(line));
  lines.emit("line", 'Filtering the log data using "..."');
  const since = Date.parse("2026-10-22T04:57:28.000Z");
  const pending = windows.window(since, 1_000);
  for (const line of fixture("sign-out-dropped.txt")) lines.emit("line", ndjson(line));

  const window = await pending;
  expect(window).toHaveLength(3);
  expect(window?.[0]).toContain(
    "04:57:28.179222+0000 testmanagerd: Recap event action playback initiated",
  );
  expect(window?.[1]).toContain(
    "canceling paths contacts: [pathIndex: 2; touchIdentifier: 75; touching",
  );
  expect(await windows.window(Date.parse("2026-10-22T05:00:00.000Z"), 10)).toBeUndefined();
});
