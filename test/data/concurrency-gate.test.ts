import { createConcurrencyGate } from "@data/concurrency-gate";
import { expect, it } from "vitest";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A gate plus a set of named reads that only settle when the test says so, so a
 * test asserts on exactly which reads have been admitted at each point.
 */
function harness(limit: number) {
  const gate = createConcurrencyGate(limit);
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  return {
    started,
    run: (name: string, signal?: AbortSignal): Promise<string> =>
      gate(() => {
        started.push(name);
        return new Promise<string>((resolve) => finishers.set(name, () => resolve(name)));
      }, signal),
    finish: (name: string): void => finishers.get(name)?.(),
  };
}

it("holds admitted reads at the limit and admits the next one on release", async () => {
  const { run, finish, started } = harness(2);
  const runs = [run("a"), run("b"), run("c")];

  await tick();
  expect(started).toEqual(["a", "b"]);

  finish("a");
  await tick();
  expect(started).toEqual(["a", "b", "c"]);

  finish("b");
  finish("c");
  await expect(Promise.all(runs)).resolves.toEqual(["a", "b", "c"]);
});

it("hands each released slot to the longest-waiting caller", async () => {
  const { run, finish, started } = harness(1);
  const live = new AbortController().signal;
  const runs = [run("first"), run("second", live), run("third", live)];

  await tick();
  finish("first");
  await tick();
  finish("second");
  await tick();
  finish("third");

  await expect(Promise.all(runs)).resolves.toEqual(["first", "second", "third"]);
  expect(started).toEqual(["first", "second", "third"]);
});

it("rejects a queued caller on abort without freeing a slot", async () => {
  const { run, finish, started } = harness(1);
  const controller = new AbortController();
  const admitted = run("held");
  const abandoned = run("abandoned", controller.signal);
  const behind = run("behind");

  await tick();
  expect(started).toEqual(["held"]);

  controller.abort(new Error("scrolled away"));
  await expect(abandoned).rejects.toThrow("scrolled away");
  await tick();
  expect(started).toEqual(["held"]);

  finish("held");
  await tick();
  expect(started).toEqual(["held", "behind"]);

  finish("behind");
  await expect(Promise.all([admitted, behind])).resolves.toEqual(["held", "behind"]);
});

it("rejects a caller whose signal is already aborted", async () => {
  const { run, started } = harness(1);

  await expect(run("gone", AbortSignal.abort(new Error("stale")))).rejects.toThrow("stale");
  expect(started).toEqual([]);
});

it("frees the slot of an in-flight read whose signal aborts, once it settles", async () => {
  const { run, finish, started } = harness(1);
  const controller = new AbortController();
  const inFlight = run("in-flight", controller.signal);
  const queued = run("queued");

  await tick();
  controller.abort(new Error("scrolled away"));
  await tick();
  expect(started).toEqual(["in-flight"]);

  finish("in-flight");
  await expect(inFlight).resolves.toBe("in-flight");
  await tick();
  expect(started).toEqual(["in-flight", "queued"]);

  finish("queued");
  await expect(queued).resolves.toBe("queued");
});

it("frees the slot on release with nothing queued, admitting a later caller", async () => {
  const { run, finish, started } = harness(1);
  const first = run("first");

  await tick();
  finish("first");
  await expect(first).resolves.toBe("first");

  const second = run("second");
  await tick();
  expect(started).toEqual(["first", "second"]);

  finish("second");
  await expect(second).resolves.toBe("second");
});

it("frees the slot when a read throws", async () => {
  const gate = createConcurrencyGate(1);
  const failing = gate(() => Promise.reject(new Error("offline")));
  const next = gate(() => Promise.resolve("after"));

  await expect(failing).rejects.toThrow("offline");
  await expect(next).resolves.toBe("after");
});
