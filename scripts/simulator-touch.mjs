import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// XCTest plays each synthesized tap through a virtual touchscreen that
// backboardd attaches for that one event; testmanagerd logs "playback
// initiated", and backboardd's "purge sender info" ends the event. Two ways the
// simulator drops the tap show in that window:
// - backboardd sees the touchscreen's first event before it has cached the
//   sender, keeps two touch records, and when the touchscreen goes away cancels
//   a contact that is still down ("canceling paths ... touching");
// - backboardd sets the touch down only after testmanagerd has cancelled the
//   touchscreen ("service canceled"), seconds late, so the app gets it out of
//   time and the control does not act.
export const PLAYBACK_PREDICATE =
  '(process == "testmanagerd" AND (eventMessage CONTAINS "Recap event action playback" OR eventMessage CONTAINS "service canceled")) OR (process == "backboardd" AND (eventMessage CONTAINS "canceling paths" OR eventMessage CONTAINS "touch down without previous range event" OR eventMessage CONTAINS "purge sender info"))';
const CANCELLED_CONTACT = /canceling paths contacts: \[[^\]]*\btouching\b/;
const IGNORED_DIGITIZER = /ignoring digitizer event/;
const SERVICE_CANCELED = /\bservice canceled\b/;
const TOUCH_DOWN = /touch down without previous range event/;
const PLAYBACK_INITIATED = /playback initiated/;
export const PLAYBACK_END = /purge sender info/;

/** The simulator log lines, in order, where backboardd threw away or delayed a synthesized touch. */
export function droppedTouches(lines) {
  let canceled = false;
  return lines.filter((line) => {
    if (PLAYBACK_INITIATED.test(line) || PLAYBACK_END.test(line)) canceled = false;
    if (SERVICE_CANCELED.test(line)) canceled = true;
    return (
      CANCELLED_CONTACT.test(line) ||
      IGNORED_DIGITIZER.test(line) ||
      (canceled && TOUCH_DOWN.test(line))
    );
  });
}

const contains = ({ X, Y, Width, Height }, { x, y }) =>
  x >= X && x <= X + Width && y >= Y && y <= Y + Height;

/** The topmost, deepest element of a runner view hierarchy that holds the point. */
export function elementAt(element, point) {
  for (const child of [...(element.children ?? [])].reverse()) {
    if (child.frame !== undefined && contains(child.frame, point)) return elementAt(child, point);
  }
  const { children: _, ...attributes } = element;
  return attributes;
}

/**
 * Whether to play a tap again: only when the simulator log for that tap's
 * playback shows backboardd cancelling a contact that was still down, and the
 * element under the tap is unchanged, with the same bounds, label and value. A
 * switch that toggled on the cancel changed its own value, so it is not tapped
 * twice.
 */
export function tapAgain({ playback, before, after, point }) {
  const [cancel] = droppedTouches(playback);
  if (cancel === undefined) return { again: false, reason: "no dropped touch" };
  if (before === undefined || after === undefined) {
    return { again: false, reason: "no hierarchy from before and after the tap" };
  }
  const [was, is] = [elementAt(before, point), elementAt(after, point)];
  if (JSON.stringify(was) !== JSON.stringify(is)) {
    return { again: false, reason: `the element under the tap changed: ${JSON.stringify(is)}` };
  }
  return { again: true, reason: `${cancel.trim()} under ${JSON.stringify(was)}` };
}

export const tapRecordsFile = () =>
  path.join(process.env.RUNNER_TEMP ?? tmpdir(), "tap-proxy.ndjson");

/** Appends what the tap proxy found for one tap the CLI sent. */
export const recordTap = (tap) => appendFileSync(tapRecordsFile(), `${JSON.stringify(tap)}\n`);

export const recordedTaps = () =>
  existsSync(tapRecordsFile())
    ? readFileSync(tapRecordsFile(), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0;

/**
 * The tap proxy's lane health line, and why the lane fails: the runner logged
 * taps the proxy never saw, so the CLI bypassed it, or the simulator log showed
 * no playback for taps the runner answered, so the proxy could not check them.
 */
export function tapProxyHealth(taps, runnerTaps) {
  const answered = taps.filter((tap) => tap.status === 200);
  const matched = answered.filter((tap) => tap.waitMs !== undefined);
  const again = taps.filter((tap) => tap.again);
  const line = `tap proxy checked ${taps.length} taps, matched playback for ${matched.length}, saw ${taps.filter((tap) => tap.cancel).length} cancels, tapped again ${again.length}, p95 log wait ${p95(matched.map((tap) => tap.waitMs))} ms`;
  const blind = answered.length - matched.length;
  const failure =
    taps.length === 0 && runnerTaps > 0
      ? `The runner logged ${runnerTaps} taps and the tap proxy checked none, so it was not in the request path`
      : blind > 0
        ? `The simulator log showed no playback for ${blind} of the ${answered.length} taps the runner answered, so the tap proxy could not check them`
        : undefined;
  return { line, failure, again: again.map((tap) => tap.reason) };
}
