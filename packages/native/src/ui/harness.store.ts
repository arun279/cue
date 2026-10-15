import type * as Harness from "./harness";

export const HIDE_CARET: typeof Harness.HIDE_CARET = false;
export const AppIdle: typeof Harness.AppIdle = () => null;
export const SheetPresented: typeof Harness.SheetPresented = () => null;
export const SnackbarTrace: typeof Harness.SnackbarTrace = () => null;
export const PressTrace: typeof Harness.PressTrace = () => null;
export const tracePress: typeof Harness.tracePress = () => {};
export const trackSync: typeof Harness.trackSync = (run) => run();
export const useScrollAcknowledgment: typeof Harness.useScrollAcknowledgment = () => ({
  handlers: {},
  marker: null,
});
