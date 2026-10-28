import { shiftedDate } from "../src/shifted-date";

const REAL_NOW = Date.parse("2026-11-03T09:30:00.000Z");
const START = Date.parse("2026-10-15T00:00:00.000Z");

afterEach(() => jest.useRealTimers());

it("starts now and argument-less dates at the start instant and keeps time running", () => {
  jest.useFakeTimers({ now: REAL_NOW });
  const ShiftedDate = shiftedDate(START);
  expect(ShiftedDate.now()).toBe(START);
  expect(new ShiftedDate().getTime()).toBe(START);
  jest.advanceTimersByTime(90_000);
  expect(ShiftedDate.now()).toBe(START + 90_000);
  expect(new ShiftedDate().toISOString()).toBe("2026-10-15T00:01:30.000Z");
  expect(ShiftedDate()).toBe(new Date(START + 90_000).toString());
  expect(Date.now()).toBe(REAL_NOW + 90_000);
});

it("leaves explicit dates, statics, instanceof and subclasses alone", () => {
  const ShiftedDate = shiftedDate(START);
  class Stamp extends ShiftedDate {}
  expect(new ShiftedDate(0).getTime()).toBe(0);
  expect(new ShiftedDate("2026-12-25T12:00:00Z").getTime()).toBe(
    Date.parse("2026-12-25T12:00:00Z"),
  );
  expect(new ShiftedDate(2026, 0, 2, 3).getTime()).toBe(new Date(2026, 0, 2, 3).getTime());
  expect(ShiftedDate.UTC(2026, 9, 15)).toBe(START);
  expect(ShiftedDate.parse("2026-10-15T00:00:00.000Z")).toBe(START);
  expect(new Date(1) instanceof ShiftedDate).toBe(true);
  expect(new ShiftedDate() instanceof Date).toBe(true);
  expect(new Stamp(5)).toBeInstanceOf(Stamp);
});
