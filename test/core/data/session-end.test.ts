import { expect, it, vi } from "vitest";
import { isBehindOwnMark, keepOwnMark } from "@/core/stores/own-marks";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const fake = startTraktFake();

it("forgets the account's own marks when its session ends", async () => {
  const runtime = await buildRuntime();
  keepOwnMark(7, { preCompleted: 3, season: 1, number: 4, watchedAt: "2026-07-01T00:00:00.000Z" });
  expect(isBehindOwnMark(7, 3)).toBe(true);

  await runtime.endLocalSession();

  expect(isBehindOwnMark(7, 3)).toBe(false);
});

it("says once that its session ended, however many reads were waiting on the refused refresh", async () => {
  const release = fake.hold({ method: "POST", path: /^\/oauth\/token$/ });
  const endSession = vi.fn();
  const { created_at, expires_in } = fake.session();
  const runtime = await buildRuntime({
    token: { access_token: "stale-access", refresh_token: "never-issued", created_at, expires_in },
    endSession,
  });
  const reads = [
    runtime.loadUserProfile(),
    runtime.loadMovieWatchlist(),
    runtime.loadCalendar("2026-10-15", 7),
  ].map((read) => read.catch(() => null));
  await vi.waitFor(() =>
    expect(fake.requests.filter((request) => request.status === 401)).toHaveLength(3),
  );

  release();
  await Promise.all(reads);

  await vi.waitFor(() => expect(endSession).toHaveBeenCalled());
  expect(endSession).toHaveBeenCalledTimes(1);
});
