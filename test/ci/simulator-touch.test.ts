import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { elementsAt, tapAgain, tapProxyHealth } from "../../scripts/simulator-touch.mjs";
import { repositoryPath } from "../support/repository-path";

const playback = (name: string) =>
  readFileSync(repositoryPath(`test/ci/fixtures/simulator-touch/${name}`), "utf8")
    .trim()
    .split("\n");

type Element = { frame: { X: number; Y: number; Width: number; Height: number } } & Record<
  string,
  unknown
>;
const screen = (...controls: Element[]) => ({
  label: "",
  frame: { X: 0, Y: 0, Width: 402, Height: 874 },
  children: [{ label: "", frame: { X: 0, Y: 0, Width: 402, Height: 874 }, children: controls }],
});

// The controls under each dropped tap, as the runner's hierarchy reports them.
// Run 39722599952, native-e2e-ios-light (activity): Settings' Sign out, at (201, 404).
// Run 39740669724, native-e2e-ios-light (activity): the TV shows switch, whose touch came
// down 2 s after testmanagerd cancelled its touchscreen (switch-late.txt).
const signOut = {
  identifier: "settings-sign-out",
  label: "Sign out",
  value: null,
  elementType: 9,
  frame: { X: 16, Y: 376, Width: 370, Height: 56 },
};
// The same run: the TV shows switch at (354, 280), which toggled although its touch was cancelled.
const tvShows = {
  identifier: "switch-shows",
  label: "TV shows",
  value: "1",
  elementType: 40,
  frame: { X: 323, Y: 266, Width: 63, Height: 28 },
};
// Run 39728254091, ui-screenshots-ios-dark: the Profile sheet's Done, at (349, 84).
const done = {
  identifier: "",
  label: "Done",
  value: null,
  elementType: 9,
  frame: { X: 317, Y: 66, Width: 65, Height: 36 },
};
// Run 39667013137, native-e2e-ios-light (detail): Connect Trakt under the tap #173 proved dropped, at (95, 534).
const connect = {
  identifier: "button-connect",
  label: "Connect Trakt",
  value: null,
  elementType: 9,
  frame: { X: 24, Y: 512, Width: 142, Height: 44 },
};
const alert = {
  identifier: "",
  label: "Sign out of Cue?",
  value: null,
  elementType: 7,
  frame: { X: 41, Y: 375, Width: 320, Height: 152 },
};

it.each([
  ["Sign out, whose alert never came", "sign-out-dropped.txt", signOut, { x: 201, y: 404 }],
  [
    "the Profile sheet's Done, which left the sheet open",
    "done-dropped.txt",
    done,
    { x: 349, y: 84 },
  ],
  ["Connect Trakt", "connect-dropped.txt", connect, { x: 95, y: 534 }],
])("taps %s again: the simulator cancelled the touch and nothing under it changed", (_, log, control, point) => {
  const decision = tapAgain({
    playback: playback(log),
    before: screen(control),
    after: screen(control),
    point,
  });

  expect(decision).toEqual({ again: true, reason: expect.stringContaining("canceling paths") });
});

it("compares only the element under the tap, as other parts of the screen move on", () => {
  const synced = (label: string) => ({
    label,
    value: null,
    frame: { X: 16, Y: 600, Width: 370, Height: 22 },
  });
  const decision = tapAgain({
    playback: playback("done-dropped.txt"),
    before: screen(done, synced("Last synced 1 min ago")),
    after: screen(done, synced("Last synced just now")),
    point: { x: 349, y: 84 },
  });

  expect(decision.again).toBe(true);
});

it("taps the TV shows switch again when its touch came down after the touchscreen was cancelled and it did not flip", () => {
  const off = { ...tvShows, value: "0" };
  const decision = tapAgain({
    playback: playback("switch-late.txt"),
    before: screen(off),
    after: screen(off),
    point: { x: 354, y: 280 },
  });

  expect(decision).toEqual({
    again: true,
    reason: expect.stringContaining("touch down without previous range event"),
  });
});

it("does not tap a switch again that toggled although its touch was cancelled", () => {
  const decision = tapAgain({
    playback: playback("switch-dropped.txt"),
    before: screen(tvShows),
    after: screen({ ...tvShows, value: "0" }),
    point: { x: 354, y: 280 },
  });

  expect(decision.again).toBe(false);
  expect(decision.reason).toContain('"value":"0"');
});

it.each([
  ["a tap the simulator delivered", "done-normal.txt", screen(done), screen(done)],
  [
    "a cancelled tap under which an alert appeared",
    "sign-out-dropped.txt",
    screen(signOut),
    screen(signOut, alert),
  ],
  ["a cancelled tap with no hierarchy read before it", "done-dropped.txt", undefined, screen(done)],
])("does not tap again after %s", (_, log, before, after) => {
  const point = { x: 201, y: 404 };
  expect(tapAgain({ playback: playback(log), before, after, point }).again).toBe(false);
});

it("lists the elements under a point, leaving out the full-screen containers", () => {
  expect(elementsAt(screen(signOut, alert), { x: 201, y: 404 })).toEqual([signOut, alert]);
  expect(elementsAt(screen(signOut), { x: 201, y: 404 })).toEqual([signOut]);
  expect(elementsAt(screen(signOut), { x: 5, y: 5 })).toEqual([]);
});

// The runner's own hierarchy of Up Next on the CI simulator (iOS 26.4), read from
// the same build as run 39778200836, where the Up Next tab tap at (74, 822) came
// down 1.3 s after its touchscreen was cancelled (tab-late.txt).
type Node = Record<string, unknown> & { children?: Node[] };
const upNext = (): Node =>
  JSON.parse(
    readFileSync(repositoryPath("test/ci/fixtures/simulator-touch/up-next-hierarchy.json"), "utf8"),
  ).axElement;
const tab = { x: 74, y: 822 };
/** The same hierarchy with the Up Next tab not yet selected, as it was on Library. */
const onLibrary = () => {
  const tree = upNext();
  const unselect = (node: Node): void => {
    if (node["label"] === "Up Next" && node["elementType"] === 9) node["selected"] = false;
    for (const child of node.children ?? []) unselect(child);
  };
  unselect(tree);
  return tree;
};

it("finds the Up Next tab under a tab bar tap, past the full-screen containers beside it", () => {
  const labels = elementsAt(upNext(), tab).map(
    ({ label, elementType }) => `${elementType} ${label}`,
  );

  expect(labels).toContain("22 Tab Bar");
  expect(labels).toContain("9 Up Next");
  expect(
    elementsAt(upNext(), tab).every(({ frame }) => (frame as { Height: number }).Height < 874),
  ).toBe(true);
});

it("taps a tab bar tab again when its touch was dropped and the tab did not change", () => {
  const decision = tapAgain({
    playback: playback("tab-late.txt"),
    before: onLibrary(),
    after: onLibrary(),
    point: tab,
  });

  expect(decision).toEqual({
    again: true,
    reason: expect.stringContaining("touch down without previous range event"),
  });
});

it("does not tap a tab again that became selected although its touch came late", () => {
  const decision = tapAgain({
    playback: playback("tab-late.txt"),
    before: onLibrary(),
    after: upNext(),
    point: tab,
  });

  expect(decision.again).toBe(false);
});

it("does not tap again when only full-screen containers are under the tap", () => {
  const bare = (): Node => ({
    frame: { X: 0, Y: 0, Width: 0, Height: 0 },
    children: [
      {
        elementType: 2,
        frame: { X: 0, Y: 0, Width: 402, Height: 874 },
        children: [{ frame: { X: 0, Y: 0, Width: 402, Height: 874 } }],
      },
    ],
  });

  expect(
    tapAgain({ playback: playback("tab-late.txt"), before: bare(), after: bare(), point: tab }),
  ).toEqual({
    again: false,
    reason: "only full-screen containers under the tap",
  });
});

const checked = (waitMs: number) => ({ x: 349, y: 84, status: 200, waitMs });

it("reports the taps the proxy checked, matched, saw cancelled and played again, with the p95 log wait", () => {
  const taps = [
    ...Array.from({ length: 19 }, (_, index) => checked(10 + index)),
    { ...checked(900), cancel: true, again: true, reason: "dropped Done" },
    { x: 1, y: 2, status: 500, reason: "runner answered 500" },
  ];

  expect(tapProxyHealth(taps, 21)).toEqual({
    line: "tap proxy checked 21 taps, matched playback for 20, saw 1 cancels, tapped again 1, p95 log wait 28 ms",
    failure: undefined,
    again: ["dropped Done"],
  });
});

it.each([
  ["the runner logged taps the proxy never saw", [], 62, "checked none"],
  [
    "a tap the runner answered had no playback in the log",
    [checked(20), { x: 1, y: 2, status: 200, reason: "no playback in the simulator log" }],
    2,
    "no playback for 1 of the 2 taps",
  ],
])("fails when %s", (_, taps, runnerTaps, failure) => {
  expect(tapProxyHealth(taps, runnerTaps).failure).toContain(failure);
});

it("passes a lane with no taps at all", () => {
  expect(tapProxyHealth([], 0).failure).toBeUndefined();
});
