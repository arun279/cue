import type * as Harness from "./harness";

export const AppIdle: typeof Harness.AppIdle = () => null;
export const ResponseTimingMarker: typeof Harness.ResponseTimingMarker = () => null;
export const beginResponseTiming: typeof Harness.beginResponseTiming = () => {};
export const useQueueResponseTiming: typeof Harness.useQueueResponseTiming = () => {};
