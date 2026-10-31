import { DAY_MS } from "../domain/time";
import { DEFAULT_STALENESS_THRESHOLD_MS } from "../domain/watch-status";
import type { PreferenceStorage } from "../ports/preference-storage";
import { choicePref, type Pref } from "./pref-storage";

export const THRESHOLD_OPTIONS: readonly number[] = [14, 21, 28, 42];

const DEFAULT_THRESHOLD_DAYS = DEFAULT_STALENESS_THRESHOLD_MS / DAY_MS;

export function thresholdMsFromDays(days: number): number {
  return days * DAY_MS;
}

export const thresholdPref = (storage: PreferenceStorage): Pref<number> =>
  choicePref(storage, "cue.staleness-threshold-days", THRESHOLD_OPTIONS, DEFAULT_THRESHOLD_DAYS);
