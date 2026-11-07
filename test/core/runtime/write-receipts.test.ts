import { beforeEach, expect, it } from "vitest";
import { buildAddEpisodePlayOp } from "@/core/domain/write-queue/ops";
import { createWriteReceipts } from "@/core/runtime/write-receipts";
import { usePlayPolicy } from "@/core/stores/play-policy-store";
import { memoryKeyValueStore } from "../support/stores";

beforeEach(() => usePlayPolicy.setState({ policy: "unknown" }));

const replay = buildAddEpisodePlayOp({
  opId: "replay",
  ids: { trakt: 1 },
  watchedAt: "2026-03-04T05:06:00.000Z",
});
const answer = (data: unknown) => ({ status: 201, headers: {}, data });

it("believes what a write added only when Trakt answered its first send", async () => {
  const receipts = await createWriteReceipts(memoryKeyValueStore());
  const added = answer({ added: { episodes: 1 } });

  expect(receipts.settle(replay, added, false)).toBe(true);
  expect([receipts.receiptOf("replay"), usePlayPolicy.getState().policy]).toEqual([
    null,
    "unknown",
  ]);
  receipts.settle(replay, added, true);
  expect([receipts.receiptOf("replay")?.added, usePlayPolicy.getState().policy]).toEqual([
    1,
    "multiple",
  ]);
});
