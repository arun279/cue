import { it } from "vitest";

// A module that never finishes loading, as a stuck import does: no test timeout applies.
await new Promise(() => {});

it("never runs", () => {});
