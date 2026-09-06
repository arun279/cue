/**
 * The shared assertions live in `@cue/core`'s test tree and import their test
 * API from `vitest`, because the two packages that ran them first are vitest
 * projects. Jest declares the same four names as globals, so this module stands
 * in for `vitest` under the jest lane (`moduleNameMapper` in `jest.config.js`)
 * and the contract suite runs unchanged in both runners rather than being
 * transcribed into a second copy that can drift.
 */
const jestDescribe = describe;
const jestIt = it;
const jestExpect = expect;
const jestBeforeEach = beforeEach;

export {
  jestBeforeEach as beforeEach,
  jestDescribe as describe,
  jestExpect as expect,
  jestIt as it,
};
