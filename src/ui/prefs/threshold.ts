import { DEFAULT_STALENESS_THRESHOLD_MS } from "@domain/watch-status";

const STORAGE_KEY = "cue.staleness-threshold-days";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The staleness-threshold choices, as week-multiples anchored to weekly release
 * cadence: 2 / 3 / 4 / 6 weeks, stored as days. Every option is a
 * whole number of weeks so each choice keeps the same cadence justification.
 */
export const THRESHOLD_OPTIONS: readonly number[] = [14, 21, 28, 42];

/**
 * 21 days — three stacked unwatched weekly episodes, the knee past single-skip
 * tolerance before backlog dread. Derived from the domain constant so the default
 * stays a single source of truth.
 */
const DEFAULT_THRESHOLD_DAYS = DEFAULT_STALENESS_THRESHOLD_MS / DAY_MS;

export function thresholdMsFromDays(days: number): number {
  return days * DAY_MS;
}

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const days = Number(raw);
    return THRESHOLD_OPTIONS.includes(days) ? days : null;
  } catch {
    return null;
  }
}

/** A stored choice wins; otherwise the principled 21-day default. */
export function initialThresholdDays(): number {
  return readStored() ?? DEFAULT_THRESHOLD_DAYS;
}

export function persistThresholdDays(days: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(days));
  } catch {
    // A restricted-storage failure just forgets the choice next visit — non-fatal.
  }
}
