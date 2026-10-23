import { INCIDENTS_KEY, OP_LOG_KEY, PLAY_POLICY_KEY } from "@cue/core/ports/storage-keys";
import { expect, it } from "vitest";
import { buildRuntime, memoryKv } from "./_runtime";

it("reads everything it keeps on the device in one round, before waiting on any of it", async () => {
  const kv = memoryKv();
  const requested: string[] = [];
  const held: (() => void)[] = [];
  const read = kv.read;
  kv.read = (key) => {
    requested.push(key);
    return new Promise((resolve) => held.push(() => resolve(read(key))));
  };

  const starting = buildRuntime({ kv });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(requested.sort()).toEqual([INCIDENTS_KEY, PLAY_POLICY_KEY, OP_LOG_KEY].sort());
  for (const release of held.splice(0)) release();
  await expect(starting).resolves.toBeDefined();
});
