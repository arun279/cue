import type { Haptics } from "@cue/core/ports/haptics";
import { CueHaptics } from "../modules/cue-native/src";
import { createNativeHaptics } from "../src/platform/haptics";

jest.mock("../modules/cue-native/src", () => ({
  CueHaptics: {
    success: jest.fn(),
    failure: jest.fn(),
    warning: jest.fn(),
    thresholdActivate: jest.fn(),
    thresholdDeactivate: jest.fn(),
    selection: jest.fn(),
    contextClick: jest.fn(),
    prepare: jest.fn(),
  },
}));

/** Every port verb and the local module's function for it. The two native
 * classes own which system effect plays; this seam only owns the routing, and
 * the pairing is what stops a new verb reaching the wrong generator. */
const vocabulary = [
  ["success", CueHaptics.success],
  ["failure", CueHaptics.failure],
  ["warning", CueHaptics.warning],
  ["thresholdActivate", CueHaptics.thresholdActivate],
  ["thresholdDeactivate", CueHaptics.thresholdDeactivate],
  ["selection", CueHaptics.selection],
  ["contextClick", CueHaptics.contextClick],
  ["prepare", CueHaptics.prepare],
] as const satisfies readonly (readonly [keyof Haptics, unknown])[];

beforeEach(() => jest.clearAllMocks());

it.each(vocabulary)("routes %s to its own module function and nothing else", (verb, fired) => {
  createNativeHaptics(() => true)[verb]();
  for (const [, fn] of vocabulary) {
    expect(fn).toHaveBeenCalledTimes(fn === fired ? 1 : 0);
  }
});

it("covers every verb the port declares, so a new one cannot arrive untested", () => {
  expect(vocabulary.map(([verb]) => verb).toSorted()).toEqual(
    Object.keys(createNativeHaptics(() => true)).toSorted(),
  );
});

it("fires nothing while the Settings toggle is off", () => {
  const haptics = createNativeHaptics(() => false);
  for (const [verb] of vocabulary) haptics[verb]();
  for (const [, fn] of vocabulary) expect(fn).not.toHaveBeenCalled();
});
