import type * as Harness from "./harness";

export const relativeTimeNow: typeof Harness.relativeTimeNow = () => Date.now();
export const SnackbarRouteDismissal: typeof Harness.SnackbarRouteDismissal = () => null;
export const HIDE_CARET: typeof Harness.HIDE_CARET = false;
export const useOnboardingAcknowledgment: typeof Harness.useOnboardingAcknowledgment = () => ({
  onLayout: undefined,
  marker: null,
});
export const AppIdle: typeof Harness.AppIdle = () => null;
export const usePerfCommand: typeof Harness.usePerfCommand = () => {};
export const usePerfScroll: typeof Harness.usePerfScroll = () => {};
export const SheetPresented: typeof Harness.SheetPresented = () => null;
export const SnackbarTrace: typeof Harness.SnackbarTrace = () => null;
export const PressTrace: typeof Harness.PressTrace = () => null;
export const tracePress: typeof Harness.tracePress = () => {};
export const trackSync: typeof Harness.trackSync = (run) => run();
export const useScrollAcknowledgment: typeof Harness.useScrollAcknowledgment = () => ({
  handlers: {},
  marker: null,
});
export const usePullTrace: typeof Harness.usePullTrace = () => ({ handlers: {}, marker: null });
