import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// XCTest plays each synthesized tap through a virtual touchscreen that
// backboardd attaches for that one event, between testmanagerd's "playback
// initiated" and "playback completed". When backboardd sees the touchscreen's
// first event before it has cached the sender ("unknown senderID"), it keeps two
// touch records, the lift lands in the other one, and when the touchscreen goes
// away it cancels a contact that is still down ("canceling paths ... touching").
// The app gets a touch down and a system cancel, never a lift.
export const PLAYBACK_PREDICATE =
  '(process == "testmanagerd" AND eventMessage CONTAINS "Recap event action playback") OR (process == "backboardd" AND eventMessage CONTAINS "canceling paths")';
const CANCELLED_CONTACT = /canceling paths contacts: \[[^\]]*\btouching\b/;
const IGNORED_DIGITIZER = /ignoring digitizer event/;

/** The line of a tap's playback where backboardd cancelled a contact that was still down. */
export const cancelledContact = (playback) => playback.find((line) => CANCELLED_CONTACT.test(line));

/** The simulator log lines where backboardd threw away a synthesized touch. */
export const droppedTouches = (log) =>
  log.split("\n").filter((line) => CANCELLED_CONTACT.test(line) || IGNORED_DIGITIZER.test(line));

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
  const cancel = cancelledContact(playback);
  if (cancel === undefined) return { again: false, reason: "no cancelled contact" };
  if (before === undefined || after === undefined) {
    return { again: false, reason: "no hierarchy from before and after the tap" };
  }
  const [was, is] = [elementAt(before, point), elementAt(after, point)];
  if (JSON.stringify(was) !== JSON.stringify(is)) {
    return { again: false, reason: `the element under the tap changed: ${JSON.stringify(is)}` };
  }
  return { again: true, reason: `${cancel.trim()} under ${JSON.stringify(was)}` };
}

export const occurrencesFile = () =>
  path.join(process.env.RUNNER_TEMP ?? tmpdir(), "simulator-touch-cancels.log");

export const recordTapAgain = (reason) =>
  appendFileSync(occurrencesFile(), `${new Date().toISOString()} ${reason}\n`);

export const provenCancels = () =>
  existsSync(occurrencesFile())
    ? readFileSync(occurrencesFile(), "utf8").split("\n").filter(Boolean)
    : [];
