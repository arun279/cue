import { DEFAULT_STALENESS_THRESHOLD_MS } from "@domain/watch-status";
import { choicePref } from "./pref-storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The staleness-threshold choices, as week-multiples anchored to weekly release
 * cadence: 2 / 3 / 4 / 6 weeks, stored as days. Every option is a
 * whole number of weeks so each choice keeps the same cadence justification.
 */
export const THRESHOLD_OPTIONS: readonly number[] = [14, 21, 28, 42];

/**
 * 21 days: three stacked unwatched weekly episodes, the knee past single-skip
 * tolerance before backlog dread. Derived from the domain constant so the default
 * stays a single source of truth.
 */
const DEFAULT_THRESHOLD_DAYS = DEFAULT_STALENESS_THRESHOLD_MS / DAY_MS;

export function thresholdMsFromDays(days: number): number {
  return days * DAY_MS;
}

/** A stored choice wins; otherwise the principled 21-day default. */
export const thresholdPref = choicePref(
  "cue.staleness-threshold-days",
  THRESHOLD_OPTIONS,
  DEFAULT_THRESHOLD_DAYS,
);
