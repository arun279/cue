// The fake holds every call open until the test lets it finish, so overlap is
// whatever the adapters allow rather than whatever timing happens to produce.
const held: { readonly settle: (fail?: boolean) => void }[] = [];
let inFlight = 0;
let mostInFlight = 0;

const holdCall = <T>(answer: T) =>
  new Promise<T>((resolve, reject) => {
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    held.push({
      settle: (fail = false) => {
        inFlight -= 1;
        if (fail) reject(new Error("Cannot use shared object that was already released"));
        else resolve(answer);
      },
    });
  });

jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => holdCall(`stored ${key}`),
    setItem: () => holdCall(undefined),
    removeItem: () => holdCall(undefined),
  },
}));

const { bulkStore } = require("../src/platform/stores") as typeof import("../src/platform/stores");
const { queryPersister } =
  require("../src/platform/query-persister") as typeof import("../src/platform/query-persister");

const finishHeld = async (failFirst = false): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise(setImmediate);
    held.shift()?.settle(failFirst && turn === 0);
  }
};

it("keeps one call at a time on the store's database while the query cache is cleared during the boot reads", async () => {
  const reads = Promise.all([bulkStore.read("cue.ops"), bulkStore.read("cue.policy")]);
  const cacheCleared = queryPersister.removeClient();
  const logWritten = bulkStore.write("cue.ops", "[]");

  await finishHeld();

  expect(await reads).toEqual(["stored cue.ops", "stored cue.policy"]);
  await expect(cacheCleared).resolves.toBeUndefined();
  await expect(logWritten).resolves.toBeUndefined();
  expect(mostInFlight).toBe(1);
});

it("lets the next call run after one that failed", async () => {
  mostInFlight = 0;
  const failed = bulkStore.read("cue.ops");
  const next = bulkStore.read("cue.policy");

  await finishHeld(true);

  expect(mostInFlight).toBe(1);
  await expect(failed).rejects.toThrow("already released");
  await expect(next).resolves.toBe("stored cue.policy");
});
