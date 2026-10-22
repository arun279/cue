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

const covers = (frame, screen) =>
  frame.X <= screen.X &&
  frame.Y <= screen.Y &&
  frame.X + frame.Width >= screen.X + screen.Width &&
  frame.Y + frame.Height >= screen.Y + screen.Height;

/**
 * Every element of a runner view hierarchy that holds the point, outermost
 * first, leaving out the containers that fill the whole screen. A tab bar
 * button sits beside full-screen siblings that also hold the point, so the
 * topmost branch alone would name a full-screen container instead of the tab.
 */
export function elementsAt(tree, point) {
  const screen = tree.children?.find(({ elementType }) => elementType === 2)?.frame ?? tree.frame;
  const found = [];
  const visit = (element) => {
    if (element.frame === undefined || !contains(element.frame, point)) return;
    const { children = [], ...attributes } = element;
    if (!covers(element.frame, screen)) found.push(attributes);
    for (const child of children) visit(child);
  };
  for (const child of tree.children ?? []) visit(child);
  return found;
}

/**
 * Whether to play a tap again: only when the simulator log for that tap's
 * playback shows it was dropped, and every element under the tap short of the
 * full-screen containers is unchanged, with the same bounds, label, value and
 * selection. A switch that toggled on the cancel changed its own value, and a
 * tab that switched changed its selection, so neither is tapped twice. With no
 * such element under the tap there is nothing to check, so no second tap.
 */
export function tapAgain({ playback, before, after, point }) {
  const [cancel] = droppedTouches(playback);
  if (cancel === undefined) return { again: false, reason: "no dropped touch" };
  if (before === undefined || after === undefined) {
    return { again: false, reason: "no hierarchy from before and after the tap" };
  }
  const [was, is] = [elementsAt(before, point), elementsAt(after, point)];
  if (was.length === 0)
    return { again: false, reason: "only full-screen containers under the tap" };
  if (JSON.stringify(was) !== JSON.stringify(is)) {
    return {
      again: false,
      reason: `the elements under the tap changed: ${JSON.stringify(is.at(-1))}`,
    };
  }
  return { again: true, reason: `${cancel.trim()} under ${JSON.stringify(was.at(-1))}` };
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
