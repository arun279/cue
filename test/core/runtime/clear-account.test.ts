import { expect, it, vi } from "vitest";
import { clearAccount } from "@/core/runtime/create-runtime";
import { isReversalRequested, requestReversal, useMarkStore } from "@/core/stores/mark-store";
import { isBehindOwnMark, keepOwnMark } from "@/core/stores/own-marks";
import { getSeasonMarkDelta, rememberSeasonMark } from "@/core/stores/season-reversal";
import { showUndoable, useSnackbar } from "@/core/stores/snackbar-store";
import { useSyncActivity } from "@/core/stores/sync-activity-store";
import { claimWriteLock, showWriteLock } from "@/core/stores/write-locks";
import { buildRuntime } from "../data/_runtime";
import { memoryKeyValueStore } from "../support/stores";
import { startTraktFake } from "../trakt-fake/in-process.ts";

startTraktFake();

it("leaves nothing of the last account in the app's own stores, and cancels its reminders", async () => {
  const [entry] = (await (await buildRuntime()).loadUpNext()).entries;
  if (entry === undefined) throw new Error("the fake account has no shows");
  const watchedAt = "2026-07-01T00:00:00.000Z";
  const record = {
    opId: "mark",
    showId: entry.showId,
    title: entry.title,
    code: "S1 E1",
    at: 0,
    episodeIds: { trakt: 1 },
    season: 1,
    number: 1,
    watchedAt,
    preCompleted: entry.completed,
    beforeMark: entry,
  };
  useMarkStore.getState().open(record);
  useMarkStore.getState().setBatch([record]);
  requestReversal(record.opId);
  claimWriteLock(showWriteLock(entry.showId), record.opId);
  keepOwnMark(entry.showId, { preCompleted: entry.completed, season: 1, number: 1, watchedAt });
  rememberSeasonMark(entry.showId, 1, [1, 2]);
  showUndoable("Marked", () => {});
  useSyncActivity.getState().begin();
  useSyncActivity.getState().setChecked(true);
  const reminders = { cancelAll: vi.fn(() => Promise.resolve()) };

  await clearAccount({
    kv: memoryKeyValueStore(),
    clearPersistedCaches: () => Promise.resolve(),
    clearLocalPreferences: () => {},
    reminders,
  });

  expect(useMarkStore.getState().records.size).toBe(0);
  expect(useMarkStore.getState().batch).toEqual([]);
  expect(isReversalRequested(record.opId)).toBe(false);
  expect(claimWriteLock(showWriteLock(entry.showId), "next")).toBe(true);
  expect(isBehindOwnMark(entry.showId, entry.completed)).toBe(false);
  expect(getSeasonMarkDelta(entry.showId, 1)).toBeUndefined();
  expect(useSnackbar.getState().snack).toBeNull();
  expect(useSyncActivity.getState()).toMatchObject({ pending: 0, checked: false });
  expect(reminders.cancelAll).toHaveBeenCalledTimes(1);
});
