jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));

it("delivers the app's query updates before the next task", async () => {
  let delivered = false;
  jest.isolateModules(() => {
    require("../src/platform/query-persister");
    const { notifyManager } = require("@tanstack/react-query");
    notifyManager.schedule(() => {
      delivered = true;
    });
  });
  await Promise.resolve();
  expect(delivered).toBe(true);
});
