import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import {
  droppedTouches,
  PLAYBACK_END,
  PLAYBACK_PREDICATE,
  recordTap,
  tapAgain,
} from "./simulator-touch.mjs";

const PLAYBACK_TIMEOUT_MS = 5_000;
/** Runner routes that only read, so the hierarchy read before them still shows the screen. */
const READS = new Set([
  "/viewHierarchy",
  "/screenshot",
  "/isScreenStatic",
  "/deviceInfo",
  "/runningApp",
  "/status",
  "/keyboard",
  "/appearance",
]);

/** `2026-10-22 05:39:23.518299+0000` as epoch milliseconds. */
const epoch = (timestamp) =>
  Date.parse(
    timestamp
      .replace(" ", "T")
      .replace(/(\.\d{3})\d*/, "$1")
      .replace(/([+-]\d\d)(\d\d)$/, "$1:$2"),
  );

/**
 * Collects the simulator log lines of synthesized touch playback and answers,
 * for a tap sent at `since`, the lines from its "playback initiated" through
 * backboardd's "purge sender info", which comes after a touch that arrives
 * seconds late.
 */
export function playbackWindows(lines) {
  const entries = [];
  const waiters = new Set();
  const windowSince = (since) => {
    const start = entries.findIndex((entry) => entry.at >= since && entry.initiated);
    const end = entries.findIndex((entry, index) => index > start && entry.ended);
    return start === -1 || end === -1
      ? undefined
      : entries.slice(start, end + 1).map((e) => e.line);
  };
  lines.on("line", (raw) => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const message = String(event.eventMessage ?? "");
    entries.push({
      at: epoch(String(event.timestamp)),
      initiated: message.includes("playback initiated"),
      ended: PLAYBACK_END.test(message),
      line: `${event.timestamp} ${event.processImagePath?.split("/").at(-1)}: ${message}`,
    });
    for (const waiter of waiters) waiter();
  });
  return {
    window: (since, timeoutMs = PLAYBACK_TIMEOUT_MS) =>
      new Promise((resolve) => {
        const check = () => {
          const found = windowSince(since);
          if (found === undefined) return;
          finish(found);
        };
        const timer = setTimeout(() => finish(undefined), timeoutMs);
        const finish = (found) => {
          clearTimeout(timer);
          waiters.delete(check);
          entries.splice(
            0,
            entries.findIndex((entry) => entry.at >= since),
          );
          resolve(found);
        };
        waiters.add(check);
        check();
      }),
  };
}

/** Streams the booted simulator's touch playback log; resolves once the stream runs. */
export function streamPlayback(device, onExit) {
  const stream = spawn(
    "xcrun",
    [
      "simctl",
      "spawn",
      device,
      "log",
      "stream",
      "--style",
      "ndjson",
      "--predicate",
      PLAYBACK_PREDICATE,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  stream.on("exit", onExit);
  const lines = createInterface({ input: stream.stdout });
  const playback = playbackWindows(lines);
  return new Promise((resolve) => lines.once("line", () => resolve({ playback, stream })));
}

const read = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
};

/**
 * Sits between the Maestro CLI and its iOS runner. Every request passes through
 * unchanged. After each tap it reads that tap's playback from the simulator log
 * and plays the tap once more when `tapAgain` finds the simulator cancelled it
 * and nothing changed under it, comparing the hierarchy Maestro read just before
 * the tap with a fresh one.
 */
export function createTapProxy({ runner, playback }) {
  let before;
  const forward = async (url, method, headers, body) => {
    const response = await fetch(`${runner}${url}`, {
      method,
      headers: { "content-type": headers["content-type"] ?? "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : body,
    });
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "application/json",
      body: Buffer.from(await response.arrayBuffer()),
    };
  };
  const hierarchy = (answer) => {
    try {
      return JSON.parse(answer.body.toString("utf8")).axElement;
    } catch {
      return undefined;
    }
  };
  const tap = async (request, body) => {
    const seen = before;
    before = undefined;
    const since = Date.now();
    const answer = await forward(request.url, request.method, request.headers, body);
    const point = JSON.parse(body.toString("utf8"));
    const record = (found) =>
      recordTap({ x: point.x, y: point.y, status: answer.status, ...found });
    if (answer.status !== 200) {
      record({ reason: `runner answered ${answer.status}` });
      return answer;
    }
    const answered = Date.now();
    const lines = await playback.window(since);
    if (lines === undefined) {
      record({ reason: "no playback in the simulator log" });
      return answer;
    }
    const waitMs = Date.now() - answered;
    if (droppedTouches(lines).length === 0) {
      record({ waitMs });
      return answer;
    }
    const after =
      seen === undefined
        ? undefined
        : hierarchy(await forward("/viewHierarchy", "POST", {}, seen.request));
    const decision = tapAgain({ playback: lines, before: seen?.tree, after, point });
    record({ waitMs, cancel: true, again: decision.again, reason: decision.reason });
    process.stdout.write(
      `tap at ${point.x}, ${point.y}: ${decision.again ? "tapped again" : "not tapped again"}, ${decision.reason}\n`,
    );
    return decision.again ? forward(request.url, request.method, request.headers, body) : answer;
  };
  const server = createServer(async (request, response) => {
    try {
      const body = await read(request);
      const answer =
        request.method === "POST" && request.url === "/touch"
          ? await tap(request, body)
          : await forward(request.url, request.method, request.headers, body);
      const route = new URL(request.url ?? "/", runner).pathname;
      if (route === "/viewHierarchy" && answer.status === 200) {
        before = { request: body, tree: hierarchy(answer) };
      } else if (!READS.has(route)) {
        before = undefined;
      }
      response.writeHead(answer.status, { "content-type": answer.type });
      response.end(answer.body);
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(String(error));
    }
  });
  return {
    listen: (port) =>
      new Promise((resolve) =>
        server.listen(port, "127.0.0.1", () => resolve(server.address().port)),
      ),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
