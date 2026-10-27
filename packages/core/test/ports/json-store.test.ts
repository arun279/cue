import { createJsonStore } from "@cue/core/ports/json-store";
import { expect, it } from "vitest";
import { memoryKeyValueStore } from "../support/stores";

it("reads a corrupt entry back as null rather than throwing", async () => {
  const store = memoryKeyValueStore({ "cue.json": "{ not json" });

  expect(await createJsonStore(store, "cue.json").read()).toBeNull();
});
