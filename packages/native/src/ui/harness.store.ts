import type * as Harness from "./harness";

export const HIDE_CARET: typeof Harness.HIDE_CARET = false;
export const AppIdle: typeof Harness.AppIdle = () => null;
export const useAppIdleStamp: typeof Harness.useAppIdleStamp = () => {};
export const ResponseTimingMarker: typeof Harness.ResponseTimingMarker = () => null;
export const beginResponseTiming: typeof Harness.beginResponseTiming = () => {};
export const useQueueResponseTiming: typeof Harness.useQueueResponseTiming = () => {};
